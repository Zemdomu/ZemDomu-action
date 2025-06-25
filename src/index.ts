import * as core from "@actions/core";
import { glob } from "glob";
import { ProjectLinter } from "zemdomu";

async function run(): Promise<void> {
  try {
    // Read inputs
    const patternsInput = core.getInput("files") || "**/*.{html,jsx,tsx}";
    const patterns = patternsInput.split(/[\n, ]+/).filter(Boolean);
    const cross = core.getBooleanInput("crossComponentAnalysis", {
      required: false,
    });

    // Expand glob patterns
    const files = new Set<string>();
    for (const pattern of patterns) {
      const matches = await glob(pattern, { nodir: true });
      for (const m of matches) {
        files.add(m);
      }
    }

    // Run the linter
    const linter = new ProjectLinter({ crossComponentAnalysis: cross });
    const results = await linter.lintFiles(Array.from(files));

    // Report issues with annotations
    let foundErrors = false;
    for (const [file, issues] of results.entries()) {
      if (issues.length > 0) {
        foundErrors = true;
      }
      for (const issue of issues) {
        core.error(`${issue.message} (${issue.rule})`, {
          file,
          startLine: issue.line + 1,
          startColumn: issue.column != null ? issue.column + 1 : undefined,
        });
      }
    }

    // If errors, provide a summary of files and lines
    if (foundErrors) {
      core.info("\nSemantic lint errors summary:");
      for (const [file, issues] of results.entries()) {
        if (issues.length > 0) {
          core.info(`In file: ${file}`);
          for (const issue of issues) {
            const line = issue.line + 1;
            const col = issue.column != null ? issue.column + 1 : 0;
            core.info(`  Line ${line}:${col} — ${issue.rule}`);
          }
        }
      }
      core.setFailed("Semantic lint errors found");
    }
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

run();
