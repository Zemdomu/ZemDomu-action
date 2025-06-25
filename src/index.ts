import * as core from "@actions/core";
import { glob } from "glob";
import { ProjectLinter, LintIssue } from "zemdomu";
import { promises as fs } from "fs";

class FixedProjectLinter extends ProjectLinter {
  async lintFile(filePath: string, content?: string) {
    if (!content) {
      content = await fs.readFile(filePath, "utf8");
    }
    if (filePath.endsWith(".html")) {
      content = content.replace(/<!DOCTYPE[^>]*>/i, "");
    }
    return super.lintFile(filePath, content);
  }
}

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
    const warnInput = core.getInput("warningOnly");
    const warnOnly = warnInput ? /^(true|1)$/i.test(warnInput) : false;

    // Determine file list (literal vs glob)
    const files = new Set<string>();
    if (patterns.every(p => !/[*?\[]/.test(p))) {
      // literal paths only
      for (const p of patterns) files.add(p);
    } else {
      // expand glob patterns
      for (const pattern of patterns) {
        const matches = await glob(pattern, {
          nodir: true,
          ignore: ["**/node_modules/**", "**/dist/**", "**/.github/**"],
        });
        for (const m of matches) files.add(m);
      }
    }

    // Run the linter
    const linter = new FixedProjectLinter({ crossComponentAnalysis: cross });
    const results = await linter.lintFiles(Array.from(files));

    // Report issues
    const isActions = process.env.GITHUB_ACTIONS === "true";
    let errorCount = 0;
    let warningCount = 0;

    for (const [file, issues] of results.entries()) {
      for (const issue of issues as LintIssue[]) {
        const sev = core.getInput(issue.rule) as 'off' | 'warning' | 'error';
        if (sev === 'off') {
          continue;
        }
        const asError = sev === 'error' && !warnOnly;
        const msg = `${issue.message} (${issue.rule})`;
        const annotation = {
          file,
          startLine: issue.line + 1,
          startColumn: issue.column != null ? issue.column + 1 : undefined,
        };
        if (asError) {
          errorCount++;
          core.error(msg, annotation);
        } else {
          warningCount++;
          core.warning(msg, annotation);
        }
        if (isActions) {
          const kind = asError ? 'error' : 'warning';
          const col = issue.column != null ? issue.column + 1 : 0;
          console.log(`::${kind} file=${file},line=${issue.line + 1},col=${col}::${msg}`);
        }
      }
    }

    const total = errorCount + warningCount;
    if (total > 0) {
      core.info(`\nSemantic lint summary: ${errorCount} error(s), ${warningCount} warning(s)`);
    }

    const exitCode = errorCount > 0 && !warnOnly ? 1 : 0;
    process.exit(exitCode);
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

parseCliArgs();
run();
