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

function issuesToSarif(
  results: Map<string, LintIssue[]>,
  config: Record<string, "off" | "warning" | "error">
) {
  const sarif: any = {
    version: "2.1.0",
    $schema:
      "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json",
    runs: [
      {
        tool: {
          driver: {
            name: "ZemDomu",
            informationUri: "https://www.npmjs.com/package/zemdomu",
            rules: [],
          },
        },
        results: [],
      },
    ],
  };
  const ruleSet = new Set();
  for (const issues of results.values()) {
    for (const issue of issues) {
      ruleSet.add(issue.rule);
    }
  }
  sarif.runs[0].tool.driver.rules = Array.from(ruleSet).map((rule) => ({
    id: rule,
    name: rule,
  }));
  for (const [file, issues] of results.entries()) {
    for (const issue of issues) {
      let sev = config[issue.rule] as "off" | "warning" | "error" | undefined;
      if (!sev) sev = issue.severity;
      if (sev === "off") continue;
      sarif.runs[0].results.push({
        ruleId: issue.rule,
        message: { text: issue.message },
        level: sev === "error" ? "error" : "warning",
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: file },
              region: {
                startLine: issue.line + 1,
                startColumn:
                  issue.column != null ? issue.column + 1 : undefined,
              },
            },
          },
        ],
      });
    }
  }
  return sarif;
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
    const configPath = core.getInput("configPath") || ".zemdomurc.json";

    let config: Record<string, "off" | "warning" | "error"> = {};
    try {
      const raw = await fs.readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.rules &&
        typeof parsed.rules === "object"
      ) {
        config = parsed.rules;
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        core.warning(
          `Failed to read config file ${configPath}: ${(err as Error).message}`
        );
      }
    }

    // Determine file list (literal vs glob)
    const files = new Set<string>();
    if (patterns.every((p) => !/[*?\[]/.test(p))) {
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
    let errorCount = 0;
    let warningCount = 0;

    for (const [file, issues] of results.entries()) {
      for (const issue of issues as LintIssue[]) {
        let sev = config[issue.rule] as "off" | "warning" | "error" | undefined;
        if (!sev) {
          sev = issue.severity;
        }
        if (sev === "off") {
          continue;
        }
        const asError = sev === "error" && !warnOnly;
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
        // core.error and core.warning already emit workflow commands.
        // Avoid printing them again to prevent duplicate annotations.
      }
    }

    const total = errorCount + warningCount;
    if (total > 0) {
      core.info(
        `\nSemantic lint summary: ${errorCount} error(s), ${warningCount} warning(s)`
      );
    }

    const sarifOutput =
      process.argv.includes("--sarif") || process.argv.includes("--sarif-file");
    if (sarifOutput) {
      const sarif = issuesToSarif(results, config);
      const outPath = process.argv.includes("--sarif-file")
        ? process.argv[process.argv.indexOf("--sarif-file") + 1]
        : "zemdomu-report.sarif";
      await fs.writeFile(outPath, JSON.stringify(sarif, null, 2), "utf8");
      core.info(`SARIF report written to ${outPath}`);
    }

    const exitCode = errorCount > 0 && !warnOnly ? 1 : 0;
    process.exit(exitCode);
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

parseCliArgs();
run();
