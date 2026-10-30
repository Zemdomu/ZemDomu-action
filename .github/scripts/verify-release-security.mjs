#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPOSITORIES = new Set([
  "Zemdomu/ZemDomu-core",
  "Zemdomu/ZemDomu-extension",
  "Zemdomu/ZemDomu-action",
]);
const WORKFLOW_PATH = ".github/workflows/codeql.yml";
const validId = value => Number.isSafeInteger(value) && value > 0;

function githubApi(endpoint) {
  return JSON.parse(execFileSync("gh", ["api", "--hostname", "github.com", endpoint], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

export async function verifyReleaseSecurity({ repository, expectedCommit, github = githubApi }) {
  if (!REPOSITORIES.has(repository)) throw new Error("Repository is not an approved public product repository.");
  if (typeof expectedCommit !== "string" || !/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error("An exact lowercase 40-character public commit SHA is required.");
  }
  const prefix = `repos/${repository}`;
  async function read(endpoint) {
    try {
      return await github(`${prefix}/${endpoint}`);
    } catch {
      // Do not print gh stderr: authentication failures can contain credential context.
      throw new Error("Cannot read public release security evidence. Check repository Contents/Actions read access, then rerun; publication remains blocked.");
    }
  }
  async function verifyMain() {
    const branch = await read("branches/main");
    if (branch?.name !== "main" || branch.commit?.sha !== expectedCommit) {
      throw new Error("Public main differs from the reviewed release SHA; reconcile and rerun before reserving or publishing a release.");
    }
  }
  function validateWorkflow(workflow) {
    if (!validId(workflow?.id) || workflow.path !== WORKFLOW_PATH || workflow.state !== "active") {
      throw new Error("Expected an active public .github/workflows/codeql.yml workflow.");
    }
  }
  function validateRun(run, workflowId) {
    if (!validId(run?.id) || !validId(run.run_number) || !validId(run.run_attempt)
        || run.workflow_id !== workflowId || run.path !== WORKFLOW_PATH
        || run.event !== "push" || run.head_branch !== "main" || run.head_sha !== expectedCommit
        || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository
        || run.html_url !== `https://github.com/${repository}/actions/runs/${run.id}`) {
      throw new Error("CodeQL run metadata does not match the exact reviewed public push/main identity.");
    }
  }
  async function latestRun(workflowId) {
    // No status/conclusion filter: a newer pending or failed run must block an older success.
    const response = await read(`actions/workflows/${workflowId}/runs?branch=main&event=push&head_sha=${expectedCommit}&per_page=100`);
    if (!Number.isSafeInteger(response?.total_count) || response.total_count < 0
        || !Array.isArray(response.workflow_runs) || response.total_count !== response.workflow_runs.length
        || response.total_count > 100) {
      throw new Error("CodeQL run history is incomplete or malformed; publication remains blocked.");
    }
    if (!response.workflow_runs.length) {
      throw new Error("No CodeQL push/main run exists for the exact reviewed public SHA. Let its CodeQL scan finish, then rerun the release.");
    }
    const ids = new Set();
    const numbers = new Set();
    for (const run of response.workflow_runs) {
      validateRun(run, workflowId);
      if (ids.has(run.id) || numbers.has(run.run_number)) throw new Error("CodeQL run history contains ambiguous duplicate identities.");
      ids.add(run.id);
      numbers.add(run.run_number);
    }
    return response.workflow_runs.reduce((latest, run) => run.run_number > latest.run_number ? run : latest);
  }
  function assertSuccessful(run) {
    if (run.status !== "completed" || run.conclusion !== "success") {
      throw new Error(`Latest CodeQL run for the exact reviewed public SHA is not completed successfully (${run.html_url}). Wait for or fix that scan, then rerun; no older success authorizes publication.`);
    }
  }
  function assertSameAttempt(run, expected) {
    if (run.id !== expected.id || run.run_number !== expected.run_number || run.run_attempt !== expected.run_attempt) {
      throw new Error("The latest CodeQL run or attempt changed during release verification; rerun before publication.");
    }
  }

  await verifyMain();
  const workflow = await read("actions/workflows/codeql.yml");
  validateWorkflow(workflow);
  const initial = await latestRun(workflow.id);
  assertSuccessful(initial);
  const current = await read(`actions/runs/${initial.id}`);
  validateRun(current, workflow.id);
  assertSameAttempt(current, initial);
  assertSuccessful(current);
  const latest = await latestRun(workflow.id);
  assertSameAttempt(latest, current);
  assertSuccessful(latest);
  const currentWorkflow = await read("actions/workflows/codeql.yml");
  validateWorkflow(currentWorkflow);
  if (currentWorkflow.id !== workflow.id) throw new Error("CodeQL workflow identity changed during verification.");
  await verifyMain();
  return { repository, commit: expectedCommit, workflowId: workflow.id, runId: current.id, runAttempt: current.run_attempt, url: current.html_url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: verify-release-security.mjs <public-repository> <reviewed-public-sha>");
    const [repository, expectedCommit] = process.argv.slice(2);
    const evidence = await verifyReleaseSecurity({ repository, expectedCommit });
    console.log(`Verified CodeQL for ${evidence.repository}@${evidence.commit}: ${evidence.url} (attempt ${evidence.runAttempt}).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
