import * as core from "@actions/core";
import { glob } from "glob";

type ZemdomuModule = typeof import("zemdomu");

let ProjectLinter: ZemdomuModule["ProjectLinter"];
try {
  ({ ProjectLinter } = require("../../ZemDomu-Core/out") as ZemdomuModule);
} catch {
  ({ ProjectLinter } = require("zemdomu") as ZemdomuModule);
}

type RulesConfig = Record<string, "error" | "warning" | "off">;

const DOCS_BASE_URL = "https://zemdomu.dev/docs/";

const DEFAULT_RULES: RulesConfig = {
  requireSectionHeading: "error",
  enforceHeadingOrder: "error",
  singleH1: "error",
  requireAltText: "error",
  requireLabelForFormControls: "error",
  enforceListNesting: "error",
  requireLinkText: "error",
  requireTableCaption: "error",
  preventEmptyInlineTags: "warning",
  requireHrefOnAnchors: "error",
  requireButtonText: "error",
  requireIframeTitle: "error",
  requireHtmlLang: "error",
  requireImageInputAlt: "error",
  requireNavLinks: "warning",
  uniqueIds: "error",
  noTabindexGreaterThanZero: "warning",
  preventZemdomuPlaceholders: "warning",
  requireDocumentTitle: "error",
  requireSingleMain: "error",
  ariaValidAttrValue: "error",
};

const DOCS_RULES = new Set(Object.keys(DEFAULT_RULES));

function docsUrlForRule(rule: string): string | null {
  if (!DOCS_RULES.has(rule)) return null;
  return `${DOCS_BASE_URL}${encodeURIComponent(rule)}`;
}

async function run(): Promise<void> {
  try {
    const patternsInput = core.getInput("files") || "**/*.{html,jsx,tsx,vue}";
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
      rules: DEFAULT_RULES,
    });
    const results = await linter.lintFiles(Array.from(files));
    let hasIssues = false;
    for (const [file, issues] of results.entries()) {
      for (const issue of issues) {
        if (issue.rule === "parseError" && file.toLowerCase().endsWith(".html")) {
          continue;
        }
        const severity = issue.severity === "warning" ? "warning" : "error";
        const log = severity === "warning" ? core.warning : core.error;
        const issueWithCode = issue as { code?: string; rule: string };
        const ruleId = issueWithCode.code ?? issue.rule;
        const docsUrl = docsUrlForRule(issue.rule);
        const message = docsUrl
          ? `${issue.message} (${ruleId}) See ${docsUrl}`
          : `${issue.message} (${ruleId})`;
        log(message, {
          file,
          startLine: issue.line + 1,
        });
        hasIssues = true;
      }
    }
    if (hasIssues) {
      core.setFailed("Semantic-HTML linting found issues; see annotations above.");
    }
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

run();
