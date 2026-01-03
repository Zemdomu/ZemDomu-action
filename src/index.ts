import * as core from "@actions/core";
import { glob } from "glob";
import { ProjectLinter } from "zemdomu";

async function run(): Promise<void> {
  try {
    const patternsInput = core.getInput("files") || "**/*.{html,jsx,tsx}";
    const patterns = patternsInput
      .split(/\r?\n/)
      .flatMap((p) => p.split(/[, ]+/))
      .filter(Boolean);

    const files = new Set<string>();
    for (const pattern of patterns) {
      const matches = await glob(pattern, { nodir: true });
      for (const m of matches) files.add(m);
    }

    const crossInput = core.getInput("crossComponentAnalysis");
    let cross = false;
    if (crossInput) {
      const normalized = crossInput.trim().toLowerCase();
      if (normalized === "true") {
        cross = true;
      } else if (normalized !== "false") {
        throw new Error('crossComponentAnalysis must be "true" or "false"');
      }
    }
    const depthInput = core.getInput("crossComponentDepth");
    const depth = depthInput ? parseInt(depthInput, 10) : undefined;
    const linter = new ProjectLinter({
      crossComponentAnalysis: cross,
      crossComponentDepth: depth,
    });
    const results = await linter.lintFiles(Array.from(files));
    let hasIssues = false;
    for (const [file, issues] of results.entries()) {
      for (const issue of issues) {
        core.error(`${issue.message} (${issue.rule})`, {
          file,
          startLine: issue.line + 1,
        });
        hasIssues = true;
      }
    }
    if (hasIssues) {
      core.setFailed("Semantic-HTML linting failed; see errors above.");
    }
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

run();
