const assert = require("assert").strict;
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parse } = require("yaml");

const packageRoot = path.join(__dirname, "..");
const manifest = parse(fs.readFileSync(path.join(packageRoot, "action.yml"), "utf8"));
const readme = fs.readFileSync(path.join(packageRoot, "README.md"), "utf8");

assert.equal(manifest.name, "ZemDomu GitHub Action");
assert.match(manifest.description, /semantic HTML and accessibility issues/);
assert.deepEqual(Object.keys(manifest.inputs), [
  "files",
  "crossComponentAnalysis",
  "crossComponentDepth",
]);
assert.equal(manifest.inputs.files.default, "**/*.{html,jsx,tsx,vue}");
assert.equal(manifest.inputs.crossComponentAnalysis.default, "false");
assert.equal(manifest.inputs.crossComponentDepth.default, "3");
assert.equal(manifest.outputs.sarif.description.includes("SARIF 2.1.0"), true);
assert.equal(manifest.runs.using, "node24");
assert.equal(manifest.runs.main, "dist/index.js");
assert.deepEqual(manifest.branding, { icon: "check-circle", color: "blue" });
assert.ok(fs.existsSync(path.join(packageRoot, manifest.runs.main)), "bundled runtime exists");

assert.match(readme, /uses: Zemdomu\/ZemDomu-action@v0\.3\.7/);
assert.doesNotMatch(readme, /uses: Zemdomu\/ZemDomu-action@main/);
for (const input of Object.keys(manifest.inputs)) {
  assert.ok(readme.includes(`\`${input}\``), `README documents ${input}`);
}
assert.match(readme, /steps\.zemdomu\.outputs\.sarif/);
assert.match(readme, /step fails when any supported finding is\s+reported/);
assert.match(readme, /no separate Action-level severity threshold/);
assert.match(readme, /steps\.zemdomu\.outcome == 'failure'/);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "zemdomu-marketplace-"));
const validFile = path.join(fixture, "valid.html");
fs.writeFileSync(
  validFile,
  '<html lang="en"><head><title>Valid</title></head><body><main><h1>Valid</h1></main></body></html>',
);
const result = spawnSync(process.execPath, [path.join(packageRoot, manifest.runs.main)], {
  cwd: fixture,
  env: { ...process.env, INPUT_FILES: validFile, RUNNER_TEMP: fixture },
  encoding: "utf8",
});
assert.equal(result.status, 0, result.stdout + result.stderr);
assert.ok(fs.existsSync(path.join(fixture, "zemdomu.sarif")), "documented SARIF output exists");

console.log("Marketplace metadata and onboarding contract test passed");
