import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runtime = process.argv[2];
if (!["electron", "node"].includes(runtime)) {
  throw new Error("Expected native runtime: electron or node.");
}

const desktopRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const moduleRoot = resolve(workspaceRoot, "node_modules/better-sqlite3");
const installer = resolve(workspaceRoot, "node_modules/prebuild-install/bin.js");
const electronVersion = JSON.parse(
  readFileSync(resolve(workspaceRoot, "node_modules/electron/package.json"), "utf8"),
).version;

execFileSync(
  process.execPath,
  [
    installer,
    `--runtime=${runtime}`,
    `--target=${runtime === "electron" ? electronVersion : process.versions.node}`,
    `--arch=${process.arch}`,
  ],
  {
    cwd: moduleRoot,
    stdio: "inherit",
  },
);
