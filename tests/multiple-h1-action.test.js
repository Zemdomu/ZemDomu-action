const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-action-'));
const badFile = path.join(tmp, 'bad.html');
fs.writeFileSync(badFile, '<h1>One</h1><h1>Two</h1>');
const actionPath = process.env.ZEMDOMU_ACTION_PATH ||
  path.join(__dirname, '..', 'dist', 'index.js');

const result = spawnSync('node', [actionPath], {
  cwd: tmp,
  env: { ...process.env, INPUT_FILES: '*.html' },
  encoding: 'utf8'
});

if (result.status === 0) {
  console.error(result.stdout, result.stderr);
  throw new Error('Expected action to fail');
}

const output = result.stdout + result.stderr;
if (!output.includes('ZMD003')) {
  console.error(output);
  throw new Error('Expected ZMD003 warning');
}

console.log('Multiple h1 action test passed');
