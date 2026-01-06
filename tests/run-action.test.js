const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-action-'));
const badFile = path.join(tmp, 'bad.html');
fs.writeFileSync(badFile, '<img>');

const result = spawnSync('node', [path.join(__dirname, '..', 'dist', 'index.js')], {
  cwd: tmp,
  env: { ...process.env, INPUT_FILES: '*.html' },
  encoding: 'utf8'
});

if (result.status === 0) {
  console.error(result.stdout, result.stderr);
  throw new Error('Expected action to fail');
}

const output = result.stdout + result.stderr;
if (!output.includes('ZMD004')) {
  console.error(output);
  throw new Error('Expected ZMD004 warning');
}

console.log('Action process test passed');
