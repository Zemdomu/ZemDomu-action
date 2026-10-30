import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.resolve(root, process.argv[2] ?? 'dist/index.js');
const commands = [
  ['--experimental-strip-types', '--test', 'tests/runner.test.mjs', 'tests/fuzz-properties.test.js', 'tests/coverage-guard.test.mjs', 'tests/action-input-output.test.mjs'],
  ['tests/run-action.test.js'],
  ['tests/multiple-h1-action.test.js'],
  ['tests/cross-component-assets-action.test.js'],
  ['tests/canonical-diagnostics-action.test.js'],
  ['tests/file-discovery-action.test.js'],
  ['tests/marketplace-metadata.test.js'],
];

// Both production-bundle tests and source coverage execute this same list.
for (const args of commands) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ZEMDOMU_ACTION_PATH: entry },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
