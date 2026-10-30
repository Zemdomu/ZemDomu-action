import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const action = process.env.ZEMDOMU_ACTION_PATH
  || fileURLToPath(new URL('../dist/index.js', import.meta.url));
const validHtml = '<html lang="en"><head><title>Fixture</title></head><body><main><h1>Page</h1></main></body></html>';

function fixture(files, check) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zd-action-inputs-')));
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  try { check(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function runAction(root, inputs = {}, options = {}) {
  const reportDirectory = options.reportDirectory ?? path.join(root, 'reports');
  const report = path.resolve(reportDirectory.trim() || root, 'zemdomu.sarif');
  const output = options.output ?? path.join(root, 'runner-output');
  if (fs.existsSync(report)) fs.rmSync(report);
  if (options.createReportDirectory !== false && reportDirectory.trim()) {
    fs.mkdirSync(reportDirectory.trim(), { recursive: true });
  }
  if (options.createOutput !== false) fs.writeFileSync(output, '');
  const env = { ...process.env };
  for (const key of ['INPUT_FILES', 'INPUT_CROSSCOMPONENTANALYSIS', 'INPUT_CROSSCOMPONENTDEPTH']) delete env[key];
  for (const [key, value] of Object.entries(inputs)) if (value !== undefined) env[`INPUT_${key.toUpperCase()}`] = value;
  env.RUNNER_TEMP = reportDirectory;
  env.GITHUB_OUTPUT = output;
  const result = spawnSync(process.execPath, [action], { cwd: root, env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.error, undefined, `Action process failed to run: ${result.error}`);
  assert.equal(result.signal, null);
  return { ...result, report, output };
}

function resultsOf(run) {
  const sarif = JSON.parse(fs.readFileSync(run.report, 'utf8'));
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs.length, 1);
  assert.equal(sarif.runs[0].tool.driver.name, 'ZemDomu');
  return sarif.runs[0].results;
}

function assertNoPublishedOutput(run) {
  assert.equal(fs.existsSync(run.report), false);
  assert.equal(fs.readFileSync(run.output, 'utf8'), '');
  assert.doesNotMatch(run.stdout, /Wrote SARIF|::set-output/);
  assert.doesNotMatch(run.stderr, /Error analyzing file|Invalid semantic graph/);
}

test('default file input reports exact annotation/SARIF locations and publishes the runner output', () => {
  fixture({
    'clean.html': validHtml,
    'nested/bad.html': '<html lang="en"><head><title>Fixture</title></head><body>\n<main><h1>Page</h1>\n<img>\n</main></body></html>',
    'node_modules/ignored/bad.html': '<iframe></iframe>',
  }, root => {
    const run = runAction(root, {}, { reportDirectory: '   ' });
    assert.equal(run.status, 1);
    assert.equal(run.report, path.join(root, 'zemdomu.sarif'));
    assert.deepEqual(resultsOf(run), [{
      ruleId: 'ZMD004', message: { text: '<img> tag missing alt attribute' },
      locations: [{ physicalLocation: {
        artifactLocation: { uri: path.join(root, 'nested', 'bad.html') },
        region: { startLine: 3, startColumn: 1 },
      } }],
      level: 'error', properties: { 'zemdomu/schemaVersion': '1.0', 'zemdomu/rule': 'requireAltText' },
    }]);
    assert.match(run.stdout, /::error file=[^\r\n]+,line=3,col=1,title=ZMD004%3A requireAltText::/);
    assert.match(run.stdout, /::error::Semantic-HTML linting found issues; see annotations above\./);
    assert.doesNotMatch(run.stdout, /ignored|iframe|::set-output/);
    const record = fs.readFileSync(run.output, 'utf8').split(os.EOL);
    assert.match(record[0], /^sarif<<zemdomu_[0-9a-f-]+$/);
    assert.deepEqual(record, [record[0], run.report, record[0].slice('sarif<<'.length), '']);
  });
});

const nestedComponents = {
  'Page.tsx': "import One from './One'; export default function Page(){ return <main><h1>Page</h1><One/></main>; }",
  'One.tsx': "import Two from './Two'; export default function One(){ return <div><Two/></div>; }",
  'Two.tsx': "import Three from './Three'; export default function Two(){ return <div><Three/></div>; }",
  'Three.tsx': "import Four from './Four'; export default function Three(){ return <div><Four/></div>; }",
  'Four.tsx': 'export default function Four() {\n  return <img />;\n}',
};

test('cross-component inputs honor zero, the default depth three, normalized booleans and valid positive limits', () => {
  fixture(nestedComponents, root => {
    for (const depth of [undefined, '', ' \t ', '0', '3']) {
      const run = runAction(root, { files: 'Page.tsx', crossComponentAnalysis: ' TrUe ', crossComponentDepth: depth });
      assert.equal(run.status, 0, `depth ${JSON.stringify(depth)}: ${run.stdout}${run.stderr}`);
      assert.deepEqual(resultsOf(run), []);
    }
    for (const depth of ['4', ' 0004 \t', '9007199254740991']) {
      const run = runAction(root, { files: 'Page.tsx', crossComponentAnalysis: ' TrUe ', crossComponentDepth: depth });
      assert.equal(run.status, 1, run.stdout + run.stderr);
      const results = resultsOf(run);
      assert.equal(results.length, 1);
      assert.equal(results[0].ruleId, 'ZMD004');
      assert.equal(results[0].level, 'error');
      assert.deepEqual(results[0].locations[0].physicalLocation, {
        artifactLocation: { uri: path.join(root, 'Four.tsx') },
        region: { startLine: 2, startColumn: 10 },
      });
    }
    for (const cross of [undefined, 'false', ' FaLsE ']) {
      const run = runAction(root, { files: 'Page.tsx', crossComponentAnalysis: cross, crossComponentDepth: '4' });
      assert.equal(run.status, 0);
      assert.deepEqual(resultsOf(run), []);
    }
  });
});

test('rejects malformed cross-component depths before analyzing source or publishing outputs', () => {
  fixture({ 'Broken.tsx': 'export default function Broken(){ return <main>' }, root => {
    for (const depth of ['junk', '2junk', '1.5', '-1', '-0', '+1', '1e2', '0x10', 'NaN', 'Infinity', '9007199254740992']) {
      const run = runAction(root, { files: 'Broken.tsx', crossComponentAnalysis: 'true', crossComponentDepth: depth });
      assert.equal(run.status, 1, `depth ${JSON.stringify(depth)} must fail`);
      assert.equal(run.stdout, `::error::crossComponentDepth must be a non-negative safe integer${os.EOL}`);
      assertNoPublishedOutput(run);
    }
  });
});

test('rejects unknown boolean input before analyzing source or publishing outputs', () => {
  fixture({ 'Broken.tsx': 'export default function Broken(){ return <main>' }, root => {
    const run = runAction(root, { files: 'Broken.tsx', crossComponentAnalysis: 'perhaps' });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, `::error::crossComponentAnalysis must be "true" or "false"${os.EOL}`);
    assertNoPublishedOutput(run);
  });
});

test('malformed TSX remains a failing parse diagnostic in annotations and SARIF', () => {
  fixture({ 'Broken.tsx': 'export default function Broken(){ return <main>' }, root => {
    const run = runAction(root, { files: 'Broken.tsx' });
    assert.equal(run.status, 1);
    const results = resultsOf(run);
    assert.equal(results.length, 1);
    assert.equal(results[0].ruleId, 'parseError');
    assert.equal(results[0].level, 'error');
    assert.match(results[0].message.text, /^Parse error: /);
    assert.equal(results[0].locations[0].physicalLocation.artifactLocation.uri, path.join(root, 'Broken.tsx'));
    assert.match(run.stdout, /title=parseError%3A parseError::Parse error:/);
    assert.match(run.stdout, /::error::Semantic-HTML linting found issues/);
  });
});

test('report filesystem failure exits unsuccessfully without claiming a published report', () => {
  fixture({ 'valid.html': validHtml, 'blocked': 'a regular file, not a directory' }, root => {
    const run = runAction(root, { files: 'valid.html' }, { reportDirectory: path.join(root, 'blocked'), createReportDirectory: false });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /^::error::/);
    assert.ok(run.stdout.includes('zemdomu.sarif'));
    assertNoPublishedOutput(run);
  });
});

test('runner-output filesystem failure preserves the completed SARIF but fails the step', () => {
  fixture({ 'valid.html': validHtml }, root => {
    const run = runAction(root, { files: 'valid.html' }, { output: path.join(root, 'missing', 'output'), createOutput: false });
    assert.equal(run.status, 1);
    assert.deepEqual(resultsOf(run), []);
    assert.equal(fs.existsSync(run.output), false);
    assert.match(run.stdout, /^::error::/);
    assert.doesNotMatch(run.stdout, /Wrote SARIF|::set-output/);
  });
});

test('discovery ignores dangling source links and keeps scanning regular files', () => {
  fixture({ 'valid.html': validHtml }, root => {
    fs.symlinkSync(path.join(root, 'missing.tsx'), path.join(root, 'dangling.tsx'), 'file');
    const run = runAction(root, { files: '**/*.{html,tsx}' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.deepEqual(resultsOf(run), []);
    assert.doesNotMatch(run.stdout, /::error|dangling|missing/);
  });
});
