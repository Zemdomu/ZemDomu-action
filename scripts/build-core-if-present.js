const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const coreDir = path.resolve(__dirname, "..", "..", "ZemDomu-Core");
const corePkg = path.join(coreDir, "package.json");

if (!fs.existsSync(corePkg)) {
  process.exit(0);
}

const coreNodeModules = path.join(coreDir, "node_modules");
if (!fs.existsSync(coreNodeModules)) {
  execSync("npm install", { cwd: coreDir, stdio: "inherit" });
}

execSync("npm run build", { cwd: coreDir, stdio: "inherit" });
