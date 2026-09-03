const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-action-discovery-'));
const actionPath = process.env.ZEMDOMU_ACTION_PATH ||
  path.join(__dirname, '..', 'dist', 'index.js');

function run(files) {
  return spawnSync(process.execPath, [actionPath], {
    cwd: root,
    env: { ...process.env, INPUT_FILES: files },
    encoding: 'utf8',
  });
}

try {
  fs.mkdirSync(path.join(root, 'nested'));
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.mkdirSync(path.join(root, 'node_modules', 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'root.html'), '<img>');
  fs.writeFileSync(path.join(root, 'nested', 'page.html'), '<h1>One</h1><h1>Two</h1>');
  fs.writeFileSync(path.join(root, 'nested', 'view.tsx'), '<a href="#" />');
  fs.writeFileSync(path.join(root, '.hidden', 'hidden.html'), '<iframe></iframe>');
  fs.writeFileSync(path.join(root, 'node_modules', 'fixture', 'vendor.html'), '<iframe></iframe>');

  const selected = run('nested\\*.html,**/*.{html,tsx},nested/page.html');
  const selectedOutput = selected.stdout + selected.stderr;
  assert.equal(selected.status, 1, selectedOutput);
  assert.match(selectedOutput, /ZMD003/);
  assert.match(selectedOutput, /ZMD004/);
  assert.match(selectedOutput, /ZMD007/);
  assert.equal((selectedOutput.match(/\(ZMD003\)/g) || []).length, 1);
  assert.doesNotMatch(selectedOutput, /hidden\.html/);
  assert.doesNotMatch(selectedOutput, /vendor\.html/);

  const empty = run('missing/**/*.html');
  assert.equal(empty.status, 0, empty.stdout + empty.stderr);
  assert.doesNotMatch(empty.stdout + empty.stderr, /::error/);

  console.log('Action file discovery test passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
