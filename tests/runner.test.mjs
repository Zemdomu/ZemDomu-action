import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, EOL } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as runner from '../src/runner.ts';

function capture(action) {
  let output = '';
  const write = process.stdout.write;
  process.stdout.write = (chunk) => { output += chunk; return true; };
  try { action(); } finally { process.stdout.write = write; }
  return output;
}

test('annotations escape injected commands and property separators', () => {
  const output = capture(() => runner.warning('bad%\r\n::error::injected', {
    file: 'a,b:c%\r\n.tsx', startLine: 2, startColumn: 3, title: 'heading, title',
  }));
  assert.equal(output, `::warning file=a%2Cb%3Ac%25%0D%0A.tsx,line=2,col=3,title=heading%2C title::bad%25%0D%0A::error::injected${EOL}`);
});

test('outputs use the runner file and safely preserve multiline values', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zd-runner-'));
  const previous = process.env.GITHUB_OUTPUT;
  const outputFile = path.join(dir, 'output');
  writeFileSync(outputFile, '');
  process.env.GITHUB_OUTPUT = outputFile;
  try {
    const value = 'report\n::error::not-a-command\nvalue%';
    assert.equal(capture(() => runner.setOutput('sarif', value)), '');
    const output = readFileSync(outputFile, 'utf8');
    const delimiter = output.split(EOL)[0].slice('sarif<<'.length);
    assert.match(delimiter, /^zemdomu_[0-9a-f-]+$/);
    assert.equal(output, `sarif<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`);
    process.env.GITHUB_OUTPUT = path.join(dir, 'missing', 'output');
    assert.throws(() => runner.setOutput('sarif', value), /ENOENT/);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inputs, failure status, and local output fallback retain the runner contract', () => {
  const previousInput = process.env.INPUT_CROSSCOMPONENTANALYSIS;
  const previousOutput = process.env.GITHUB_OUTPUT;
  const previousExit = process.exitCode;
  try {
    process.env.INPUT_CROSSCOMPONENTANALYSIS = ' true ';
    assert.equal(runner.getInput('crossComponentAnalysis'), 'true');
    delete process.env.GITHUB_OUTPUT;
    assert.equal(capture(() => runner.setOutput('sarif', 'a\nb%')), `::set-output name=sarif::a%0Ab%25${EOL}`);
    assert.equal(capture(() => runner.setFailed('bad\n::warning::injected')), `::error::bad%0A::warning::injected${EOL}`);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExit;
    if (previousInput === undefined) delete process.env.INPUT_CROSSCOMPONENTANALYSIS;
    else process.env.INPUT_CROSSCOMPONENTANALYSIS = previousInput;
    if (previousOutput === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previousOutput;
  }
});
