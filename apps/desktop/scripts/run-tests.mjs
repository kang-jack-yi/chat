import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const desktopRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const electron = require("electron");
const vitest = resolve(workspaceRoot, "node_modules/vitest/vitest.mjs");

const test = spawnSync(electron, [vitest, "run", "--passWithNoTests"], {
  cwd: desktopRoot,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit",
});

process.exit(test.status || 0);
