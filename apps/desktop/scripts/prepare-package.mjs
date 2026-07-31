import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const stageRoot = process.env.FORGE_STAGE_ROOT
  ? resolve(process.env.FORGE_STAGE_ROOT)
  : resolve(tmpdir(), `enterprise-chat-forge-${process.pid}`);
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error("This script must be run through pnpm.");
}

rmSync(stageRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
execFileSync(process.execPath, [pnpmCli, "--filter", "@chat/desktop", "deploy", stageRoot, "--prod"], {
  cwd: workspaceRoot,
  stdio: "inherit",
});

const packagePath = resolve(stageRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const electronVersion = JSON.parse(
  readFileSync(resolve(workspaceRoot, "node_modules/electron/package.json"), "utf8"),
).version;
delete packageJson.devDependencies;
delete packageJson.scripts;
delete packageJson.pnpm;
packageJson.private = true;
packageJson.devDependencies = { electron: electronVersion };
packageJson.config = { forge: "./forge.config.cjs" };
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const electronStubRoot = resolve(stageRoot, "node_modules/electron");
mkdirSync(electronStubRoot, { recursive: true });
writeFileSync(
  resolve(electronStubRoot, "package.json"),
  `${JSON.stringify({ name: "electron", version: electronVersion }, null, 2)}\n`,
);
