import * as core from "@actions/core";
import { glob } from "glob";
import { ProjectLinter } from "zemdomu";

function parseCliArgs(): void {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const name = args[i].slice(2);
      let value = "true";
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        value = args[i + 1];
        i++;
      }
      const key = `INPUT_${name.replace(/-/g, "").toUpperCase()}`;
      process.env[key] = value;
    }
  }
}

async function run(): Promise<void> {
  try {
    // Read inputs
    const patternsInput = core.getInput("files") || "**/*.{html,jsx,tsx}";
    const patterns = patternsInput.split(/\r?\n/).filter(Boolean);
    const crossInput = core.getInput("crossComponentAnalysis");
    const cross = crossInput ? /^(true|1)$/i.test(crossInput) : false;

    // Expand glob patterns
    const files = new Set<string>();
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        nodir: true,
        ignore: ["**/node_modules/**", "**/dist/**", "**/.github/**"],
      });
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

parseCliArgs();
run();
