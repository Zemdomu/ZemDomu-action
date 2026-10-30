import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyDirectSourceMaps, verifyCoverageSummary } from './verify-source-coverage.mjs';

const defaultRoot = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

function run(root, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Coverage command failed (${result.status ?? result.signal}): ${args.join(' ')}`);
}

export function runCoverage({ projectRoot = defaultRoot, compile, collect } = {}) {
  const root = fs.realpathSync(projectRoot);
  const build = path.join(root, '.coverage-build');
  const report = path.join(root, 'coverage');
  // Start fresh, and retain raw V8 data, direct tsc maps and reports for inspection.
  fs.rmSync(build, { recursive: true, force: true });
  fs.rmSync(report, { recursive: true, force: true });
  (compile ?? (() => run(root, [
    'node_modules/typescript/bin/tsc', '--outDir', build, '--sourceMap', '--inlineSources',
  ])))({ root, build });
  verifyDirectSourceMaps({ projectRoot: root, buildDirectory: build });
  (collect ?? (() => run(root, [
    'node_modules/c8/bin/c8.js', '--all', '--exclude-after-remap',
    '--include', '**/.coverage-build/**/*.js', '--include', '**/src/**/*.ts',
    '--src', 'src', '--extension', '.ts', '--extension', '.js',
    '--reports-dir', report, '--temp-directory', path.join(report, 'tmp'),
    '--reporter', 'text', '--reporter', 'html', '--reporter', 'json', '--reporter', 'json-summary',
    process.execPath, 'scripts/run-tests.mjs', path.join(build, 'index.js'),
  ])))();
  const coverage = JSON.parse(fs.readFileSync(path.join(report, 'coverage-final.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(report, 'coverage-summary.json'), 'utf8'));
  const sources = verifyCoverageSummary({ projectRoot: root, coverage, summary });
  console.log(`Verified detailed source coverage for ${sources.join(', ')}`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  runCoverage();
}
