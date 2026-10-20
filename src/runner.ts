import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { EOL } from "node:os";

export interface AnnotationProperties {
  file: string;
  startLine: number;
  startColumn: number;
  title: string;
}

function escapeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function annotation(level: string, message: string, properties?: AnnotationProperties): void {
  const fields = properties
    ? Object.entries({ file: properties.file, line: properties.startLine, col: properties.startColumn, title: properties.title })
        .map(([key, value]) => `${key}=${escapeProperty(String(value))}`).join(",")
    : "";
  process.stdout.write(`::${level}${fields ? ` ${fields}` : ""}::${escapeData(message)}${EOL}`);
}

export const error = (message: string, properties?: AnnotationProperties): void => annotation("error", message, properties);
export const warning = (message: string, properties: AnnotationProperties): void => annotation("warning", message, properties);
export const notice = (message: string, properties: AnnotationProperties): void => annotation("notice", message, properties);

export function getInput(name: string): string {
  return (process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] || "").trim();
}

export function info(message: string): void {
  // Encode line breaks so a filename cannot inject a new runner command.
  process.stdout.write(`${escapeData(message)}${EOL}`);
}

export function setFailed(message: string): void {
  process.exitCode = 1;
  error(message);
}

export function setOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    const delimiter = `zemdomu_${randomUUID()}`;
    if (name.includes(delimiter) || value.includes(delimiter) || /[\r\n]/.test(name)) {
      throw new Error("Invalid GitHub output delimiter or name");
    }
    appendFileSync(outputPath, `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`, "utf8");
  } else {
    // Preserve local execution and older runner behavior.
    process.stdout.write(`::set-output name=${escapeProperty(name)}::${escapeData(value)}${EOL}`);
  }
}
