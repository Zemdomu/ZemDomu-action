const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const fc = require('fast-check');

function integerSetting(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^[+-]?\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

const parameters = {
  numRuns: integerSetting('ZEMDOMU_FUZZ_RUNS', 250, 1, 10_000),
  seed: integerSetting('ZEMDOMU_FUZZ_SEED', 0x5a444143, -2_147_483_648, 2_147_483_647),
};
if (process.env.ZEMDOMU_FUZZ_PATH !== undefined) {
  if (!/^\d+(?::\d+)*$/.test(process.env.ZEMDOMU_FUZZ_PATH)) {
    throw new Error('ZEMDOMU_FUZZ_PATH must be the colon-separated replay path reported by fast-check');
  }
  parameters.path = process.env.ZEMDOMU_FUZZ_PATH;
}

// Scalar values cover supplementary Unicode without UTF-8 replacement of lone surrogates.
const scalar = fc.oneof(fc.integer({ min: 0, max: 0xd7ff }), fc.integer({ min: 0xe000, max: 0x10ffff }))
  .map(value => String.fromCodePoint(value));
const wireText = fc.array(fc.oneof(
  scalar,
  fc.constantFrom('%', '%0A', '%25', '\r', '\n', ':', ',', '=', '::error::injected', '::set-output name=x::bad', '🧑‍💻', 'e\u0301'),
), { maxLength: 48 }).map(parts => parts.join(''));
const safeStem = fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'), { minLength: 1, maxLength: 12 })
  .map(parts => parts.join(''));
const runnerModule = import('../src/runner.ts');

function capture(action) {
  let output = '';
  const original = process.stdout.write;
  process.stdout.write = chunk => { output += chunk; return true; };
  try { action(); } finally { process.stdout.write = original; }
  return output;
}

function withOutputFile(file, action) {
  const original = process.env.GITHUB_OUTPUT;
  if (file === undefined) delete process.env.GITHUB_OUTPUT;
  else process.env.GITHUB_OUTPUT = file;
  try { return action(); } finally {
    if (original === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = original;
  }
}

// Decode the wire protocol once; literal text such as "%0A" must stay literal.
function decodeWire(value) {
  const escapes = { '25': '%', '0A': '\n', '0D': '\r', '3A': ':', '2C': ',' };
  return value.replace(/%(25|0A|0D|3A|2C)/g, (_, code) => escapes[code]);
}

function oneCommand(output) {
  assert.ok(output.endsWith(os.EOL));
  const line = output.slice(0, -os.EOL.length);
  assert.doesNotMatch(line, /[\r\n]/, 'untrusted text must not create a second runner command');
  const separator = line.indexOf('::', 2);
  assert.ok(line.startsWith('::') && separator > 2);
  return { header: line.slice(2, separator), message: line.slice(separator + 2) };
}

test('fuzz: annotations preserve Unicode diagnostics without injecting runner commands or properties', async () => {
  const runner = await runnerModule;
  fc.assert(fc.property(
    fc.constantFrom('error', 'warning', 'notice'), wireText, wireText, wireText,
    fc.integer({ min: 1, max: 2_147_483_647 }), fc.integer({ min: 1, max: 2_147_483_647 }),
    (level, message, file, title, startLine, startColumn) => {
      const command = oneCommand(capture(() => runner[level](message, { file, title, startLine, startColumn })));
      assert.ok(command.header.startsWith(`${level} `));
      const fields = command.header.slice(level.length + 1).split(',');
      assert.equal(fields.length, 4, 'diagnostic text must not inject extra annotation properties');
      const actual = Object.fromEntries(fields.map(field => {
        const separator = field.indexOf('=');
        assert.ok(separator > 0);
        const encoded = field.slice(separator + 1);
        assert.doesNotMatch(encoded, /[,:\r\n]/);
        return [field.slice(0, separator), decodeWire(encoded)];
      }));
      assert.deepEqual(actual, { file, line: String(startLine), col: String(startColumn), title });
      assert.equal(decodeWire(command.message), message);
    },
  ), parameters);
});

test('fuzz: legacy output commands preserve values and cannot create additional commands', async () => {
  const runner = await runnerModule;
  withOutputFile(undefined, () => {
    fc.assert(fc.property(wireText, wireText, (name, value) => {
      const command = oneCommand(capture(() => runner.setOutput(name, value)));
      assert.ok(command.header.startsWith('set-output name='));
      const encodedName = command.header.slice('set-output name='.length);
      assert.doesNotMatch(encodedName, /[,:\r\n]/);
      assert.equal(decodeWire(encodedName), name);
      assert.equal(decodeWire(command.message), value);
    }), parameters);
  });
});

test('fuzz: output-file records preserve multiline Unicode values and keep every record separate', async t => {
  const runner = await runnerModule;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-output-fuzz-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'output');
  withOutputFile(file, () => {
    fc.assert(fc.property(fc.array(wireText, { minLength: 1, maxLength: 5 }), values => {
      fs.writeFileSync(file, '');
      assert.equal(capture(() => values.forEach((value, index) => runner.setOutput(`result_${index}`, value))), '');
      const records = fs.readFileSync(file, 'utf8');
      let cursor = 0;
      const delimiters = new Set();
      values.forEach((value, index) => {
        const headerEnd = records.indexOf(os.EOL, cursor);
        assert.ok(headerEnd >= cursor);
        const header = records.slice(cursor, headerEnd);
        assert.ok(header.startsWith(`result_${index}<<`));
        const delimiter = header.slice(`result_${index}<<`.length);
        assert.match(delimiter, /^zemdomu_[a-f0-9-]+$/);
        assert.ok(!delimiters.has(delimiter));
        delimiters.add(delimiter);
        const bodyStart = headerEnd + os.EOL.length;
        const terminator = `${os.EOL}${delimiter}${os.EOL}`;
        const bodyEnd = records.indexOf(terminator, bodyStart);
        assert.ok(bodyEnd >= bodyStart);
        assert.equal(records.slice(bodyStart, bodyEnd), value);
        cursor = bodyEnd + terminator.length;
      });
      assert.equal(cursor, records.length, 'no value may inject a trailing output record');
    }), parameters);
  });
});

test('fuzz: newline-bearing output names fail without appending any file bytes', async t => {
  const runner = await runnerModule;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-invalid-output-fuzz-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'output');
  withOutputFile(file, () => {
    fc.assert(fc.property(wireText, fc.constantFrom('\r', '\n', '\r\n'), wireText, (prefix, newline, value) => {
      fs.writeFileSync(file, 'existing=safe\n');
      assert.throws(() => runner.setOutput(`${prefix}${newline}injected`, value), /Invalid GitHub output/);
      assert.equal(fs.readFileSync(file, 'utf8'), 'existing=safe\n');
    }), parameters);
  });
});

test('fuzz: parsed overlapping globs discover unique source files without vendor or linked-directory traversal', async t => {
  const { discoverFiles, parseGlobPatterns } = await import('../src/file-discovery.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-discovery-fuzz-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let iteration = 0;
  await fc.assert(fc.asyncProperty(
    fc.uniqueArray(safeStem, { minLength: 1, maxLength: 7 }),
    fc.constantFrom(',', ' ', ',\n', '\t', '\r\n'),
    async (stems, separator) => {
      const directory = path.join(root, `case-${iteration++}`);
      const source = path.join(directory, 'src');
      const outside = path.join(root, `outside-${iteration}`);
      fs.mkdirSync(path.join(directory, 'node_modules', 'vendor'), { recursive: true });
      fs.mkdirSync(path.join(source, 'directory.html'), { recursive: true });
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'private.html'), '<img>');
      fs.writeFileSync(path.join(directory, 'node_modules', 'vendor', 'excluded.html'), '<img>');
      const expected = [];
      for (const stem of stems) {
        for (const extension of ['html', 'tsx']) {
          const file = path.join(source, `file-${stem}.${extension}`);
          fs.writeFileSync(file, '<img>');
          expected.push(file.replace(/\\/g, '/'));
        }
        fs.writeFileSync(path.join(source, `file-${stem}.txt`), 'not a source file');
      }
      // Windows can require additional privileges to create directory symlinks.
      if (process.platform !== 'win32') fs.symlinkSync(outside, path.join(directory, 'linked'), 'dir');
      const pattern = `${directory.replace(/\\/g, '/')}/**/*.{html,tsx}`;
      const input = [pattern, pattern.replace(/\//g, '\\'), expected[0]].join(separator);
      const actual = await discoverFiles(parseGlobPatterns(input));
      assert.deepEqual(actual, expected.sort());
      assert.ok(actual.every(file => file.startsWith(`${directory.replace(/\\/g, '/')}/`)));
      assert.ok(actual.every(file => !file.split('/').includes('node_modules')));
      fs.rmSync(directory, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    },
  ), parameters);
});
