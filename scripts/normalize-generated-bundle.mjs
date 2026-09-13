import fs from "node:fs";

for (const filePath of process.argv.slice(2)) {
  const content = fs.readFileSync(filePath, "utf8");
  const normalized = content.replace(/[ \t]+$/gm, "");

  if (normalized !== content) {
    fs.writeFileSync(filePath, normalized);
  }
}
