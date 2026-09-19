const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zd-action-assets-"));
const page = path.join(tmp, "Page.tsx");
fs.writeFileSync(
  page,
  `import "./globals.css";
import Child from "./Child";
export default function Page() { return <main><h1>Page</h1><Child /></main>; }`,
  "utf8"
);
fs.writeFileSync(
  path.join(tmp, "Child.tsx"),
  `export default function Child() { return <p>Content</p>; }`,
  "utf8"
);
fs.writeFileSync(
  path.join(tmp, "globals.css"),
  ":root { color-scheme: dark; }",
  "utf8"
);

const actionPath = process.env.ZEMDOMU_ACTION_PATH ||
  path.join(__dirname, "..", "dist", "index.js");
const result = spawnSync("node", [actionPath], {
  cwd: tmp,
  env: {
    ...process.env,
    INPUT_FILES: "Page.tsx",
    INPUT_CROSSCOMPONENTANALYSIS: "true",
  },
  encoding: "utf8",
});

assert.equal(
  result.status,
  0,
  `Expected imported stylesheets to be ignored:\n${result.stdout}${result.stderr}`
);
assert.doesNotMatch(result.stdout + result.stderr, /parseError|globals\.css/);

console.log("Cross-component asset import action test passed");
