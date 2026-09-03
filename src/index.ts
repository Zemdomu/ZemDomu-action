import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import {
  diagnosticsToSarif,
  ProjectLinter,
  type ZemDomuDiagnostic,
} from "zemdomu";
import { discoverFiles, parseGlobPatterns } from "./file-discovery";

const DOCS_BASE_URL = "https://zemdomu.dev/docs/";
const SARIF_FILE_NAME = "zemdomu.sarif";

function docsUrlForRule(rule: string): string {
  return `${DOCS_BASE_URL}${encodeURIComponent(rule)}`;
}

function annotationMessage(diagnostic: ZemDomuDiagnostic): string {
  const lines = [diagnostic.message];
  if (diagnostic.page) lines.push(`Page: ${diagnostic.page}`);
  if (diagnostic.componentPath?.length) {
    lines.push(`Component path: ${diagnostic.componentPath.join(" -> ")}`);
  }
  for (const related of diagnostic.relatedLocations ?? []) {
    const location = `${related.source.file}:${related.source.line + 1}:${related.source.column + 1}`;
    lines.push(
      `Related: ${location}${related.message ? ` - ${related.message}` : ""}`
    );
  }
  if (diagnostic.suggestion) {
    lines.push(`Suggestion: ${diagnostic.suggestion.message}`);
  }
  lines.push(`(${diagnostic.code}) See ${docsUrlForRule(diagnostic.rule)}`);
  return lines.join("\n");
}

function annotationProperties(
  diagnostic: ZemDomuDiagnostic
): core.AnnotationProperties {
  return {
    file: diagnostic.source.file,
    startLine: diagnostic.source.line + 1,
    startColumn: diagnostic.source.column + 1,
    title: `${diagnostic.code}: ${diagnostic.rule}`,
  };
}

function emitAnnotation(diagnostic: ZemDomuDiagnostic): void {
  const message = annotationMessage(diagnostic);
  const properties = annotationProperties(diagnostic);
  if (diagnostic.severity === "warning") {
    core.warning(message, properties);
  } else if (diagnostic.severity === "info") {
    core.notice(message, properties);
  } else {
    core.error(message, properties);
  }
}

function writeSarif(diagnostics: readonly ZemDomuDiagnostic[]): void {
  const outputDirectory = process.env.RUNNER_TEMP?.trim() || process.cwd();
  const sarifPath = path.resolve(outputDirectory, SARIF_FILE_NAME);
  fs.writeFileSync(
    sarifPath,
    `${JSON.stringify(diagnosticsToSarif(diagnostics), null, 2)}\n`,
    "utf8"
  );
  core.setOutput("sarif", sarifPath);
  core.info(`Wrote SARIF report to ${sarifPath}`);
}

async function run(): Promise<void> {
  try {
    const patternsInput = core.getInput("files") || "**/*.{html,jsx,tsx,vue}";
    const patterns = parseGlobPatterns(patternsInput);

    const files = await discoverFiles(patterns);

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
    const diagnostics = (
      await linter.lintPageDiagnostics(files)
    ).filter(
      (diagnostic) =>
        !(
          diagnostic.rule === "parseError" &&
          diagnostic.source.file.toLowerCase().endsWith(".html")
        )
    );
    writeSarif(diagnostics);

    let hasIssues = false;
    for (const diagnostic of diagnostics) {
      emitAnnotation(diagnostic);
      hasIssues = true;
    }
    if (hasIssues) {
      core.setFailed("Semantic-HTML linting found issues; see annotations above.");
    }
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

run();
