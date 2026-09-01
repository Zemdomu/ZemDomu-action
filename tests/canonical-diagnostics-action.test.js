const assert = require("assert").strict;
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ProjectLinter } = require("zemdomu");

function diagnosticShape(diagnostic) {
  return {
    rule: diagnostic.rule,
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    line: diagnostic.source.line,
    column: diagnostic.source.column,
  };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zd-action-canonical-"));
  const badFile = path.join(tmp, "bad.html");
  fs.writeFileSync(
    badFile,
    '<html lang="en"><head><title>Fixture</title></head><body><main><nav></nav><img></main></body></html>'
  );

  const coreDiagnostics = await new ProjectLinter().lintPageDiagnostics([badFile]);
  const coreDiagnostic = coreDiagnostics.find(({ code }) => code === "ZMD004");
  assert.ok(coreDiagnostic, "Core should report the shared ZMD004 fixture");

  const cliPath = path.join(path.dirname(require.resolve("zemdomu")), "cli.js");
  const cli = spawnSync(
    process.execPath,
    [cliPath, "check", badFile, "--format", "json"],
    { cwd: tmp, encoding: "utf8" }
  );
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  const cliDiagnostics = JSON.parse(cli.stdout);
  const cliDiagnostic = cliDiagnostics.find(({ code }) => code === "ZMD004");
  assert.ok(cliDiagnostic, "CLI should report the shared ZMD004 fixture");
  assert.deepEqual(diagnosticShape(cliDiagnostic), diagnosticShape(coreDiagnostic));

  const coreWarning = coreDiagnostics.find(({ code }) => code === "ZMD015");
  const cliWarning = cliDiagnostics.find(({ code }) => code === "ZMD015");
  assert.ok(coreWarning, "Core should report the shared ZMD015 warning fixture");
  assert.ok(cliWarning, "CLI should report the shared ZMD015 warning fixture");
  assert.deepEqual(diagnosticShape(cliWarning), diagnosticShape(coreWarning));

  const action = spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "dist", "index.js")],
    {
      cwd: tmp,
      env: {
        ...process.env,
        INPUT_FILES: badFile,
        RUNNER_TEMP: tmp,
      },
      encoding: "utf8",
    }
  );
  const actionOutput = action.stdout + action.stderr;
  assert.equal(action.status, 1, actionOutput);
  assert.match(actionOutput, /ZMD004/);
  assert.match(actionOutput, /requireAltText/);
  assert.match(actionOutput, /line=1/);
  assert.match(actionOutput, /col=\d+/);
  assert.match(actionOutput, /::warning /);
  assert.match(actionOutput, /ZMD015/);

  const sarif = JSON.parse(
    fs.readFileSync(path.join(tmp, "zemdomu.sarif"), "utf8")
  );
  const sarifResult = sarif.runs[0].results.find(
    ({ ruleId }) => ruleId === "ZMD004"
  );
  assert.ok(sarifResult, "SARIF should report the shared ZMD004 fixture");
  assert.equal(sarifResult.level, coreDiagnostic.severity);
  assert.equal(sarifResult.message.text, coreDiagnostic.message);
  assert.equal(
    sarifResult.locations[0].physicalLocation.region.startLine,
    coreDiagnostic.source.line + 1
  );
  assert.equal(
    sarifResult.locations[0].physicalLocation.region.startColumn,
    coreDiagnostic.source.column + 1
  );
  assert.equal(
    sarifResult.properties["zemdomu/rule"],
    coreDiagnostic.rule
  );
  const sarifWarning = sarif.runs[0].results.find(
    ({ ruleId }) => ruleId === "ZMD015"
  );
  assert.ok(sarifWarning, "SARIF should report the shared ZMD015 warning fixture");
  assert.equal(sarifWarning.level, "warning");

  console.log("Canonical Core/CLI/Action/SARIF parity test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
