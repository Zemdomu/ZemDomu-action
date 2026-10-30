import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyDirectSourceMaps, verifySourceCoverage } from '../scripts/verify-source-coverage.mjs';
import { runCoverage } from '../scripts/test-coverage.mjs';

function fixture(action) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zd-coverage-guard-')));
  fs.mkdirSync(path.join(root, 'src'));
  const coverage = {};
  for (const name of ['index.ts', 'runner.ts', 'file-discovery.ts']) {
    const file = path.join(root, 'src', name);
    fs.writeFileSync(file, 'export const choose = (flag: boolean) => flag ? 1 : 0;\n');
    const location = { start: { line: 1, column: 0 }, end: { line: 1, column: 52 } };
    coverage[file] = {
      path: file, statementMap: { 0: location }, s: { 0: 1 },
      fnMap: { 0: { name: 'choose', decl: location, loc: location, line: 1 } }, f: { 0: 1 },
      branchMap: { 0: { type: 'cond-expr', line: 1, loc: location, locations: [location, location] } }, b: { 0: [1, 0] },
    };
  }
  try { action(root, coverage); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('coverage guard accepts detailed counters for the exact source inventory', () => {
  fixture((root, coverage) => {
    assert.deepEqual(verifySourceCoverage({ projectRoot: root, coverage }), [
      path.join('src', 'file-discovery.ts'), path.join('src', 'index.ts'), path.join('src', 'runner.ts'),
    ]);
  });
});

test('coverage guard rejects a missing source file and generated-file leakage', () => {
  fixture((root, coverage) => {
    const file = path.join(root, 'src', 'runner.ts');
    const item = coverage[file];
    delete coverage[file];
    assert.throws(() => verifySourceCoverage({ projectRoot: root, coverage }), /Missing source coverage/);
    coverage[file] = item;
    fs.mkdirSync(path.join(root, 'dist'));
    const generated = path.join(root, 'dist', 'index.js');
    fs.writeFileSync(generated, '0;');
    coverage[generated] = { ...item, path: generated };
    assert.throws(() => verifySourceCoverage({ projectRoot: root, coverage }), /outside source inventory/);
  });
});

test('coverage guard rejects the broken-remap shape with covered lines but no entry counters', () => {
  fixture((root, coverage) => {
    const item = coverage[path.join(root, 'src', 'index.ts')];
    item.fnMap = {}; item.f = {}; item.branchMap = {}; item.b = {};
    // The old minified remap reported 100% source lines with this empty shape.
    assert.throws(() => verifySourceCoverage({ projectRoot: root, coverage }), /entry point.*counters/);
  });
});

test('coverage guard rejects entry counters that never executed or disagree with their maps', () => {
  fixture((root, coverage) => {
    const item = coverage[path.join(root, 'src', 'index.ts')];
    item.f[0] = 0; item.b[0] = [0, 0];
    assert.throws(() => verifySourceCoverage({ projectRoot: root, coverage }), /entry point.*counters/);
    item.f[0] = 1; item.b[0] = [1];
    assert.throws(() => verifySourceCoverage({ projectRoot: root, coverage }), /Invalid source branch counts/);
  });
});

test('coverage pipeline fails before collection when a real emitted map disappears or has a wrong target', () => {
  fixture((root) => {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'es2020', module: 'commonjs', rootDir: 'src', types: [], strict: true },
      include: ['src'],
    }));
    let collected = false;
    const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
    const compile = ({ build }) => {
      const result = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.json'),
        '--outDir', build, '--sourceMap', '--inlineSources'], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      verifyDirectSourceMaps({ projectRoot: root, buildDirectory: build });
      const mapFile = path.join(build, 'index.js.map');
      const text = fs.readFileSync(mapFile, 'utf8');
      const wrong = JSON.parse(text); wrong.sources = ['../src/runner.ts'];
      fs.writeFileSync(mapFile, JSON.stringify(wrong));
      assert.throws(() => verifyDirectSourceMaps({ projectRoot: root, buildDirectory: build }), /Invalid direct source map/);
      fs.writeFileSync(mapFile, text);
      fs.unlinkSync(mapFile);
    };
    assert.throws(() => runCoverage({ projectRoot: root, compile, collect: () => { collected = true; } }), /Missing emitted JavaScript or source map/);
    assert.equal(collected, false, 'map loss must fail before c8 or the functional suite starts');
    assert.equal(fs.existsSync(path.join(root, 'coverage', 'coverage-final.json')), false);
  });
});
