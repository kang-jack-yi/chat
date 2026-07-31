import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const mode = process.argv[2];
if (!["package", "make"].includes(mode)) {
  throw new Error("Expected release mode: package or make.");
}

const desktopRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const stageRoot = resolve(tmpdir(), `enterprise-chat-forge-${process.pid}`);
const forgeCli = resolve(workspaceRoot, "node_modules/@electron-forge/cli/dist/electron-forge.js");
const childEnvironment = { ...process.env, FORGE_STAGE_ROOT: stageRoot };

execFileSync(process.execPath, [resolve(import.meta.dirname, "prepare-package.mjs")], {
  cwd: desktopRoot,
  env: childEnvironment,
  stdio: "inherit",
});

if (mode === "make") {
  execFileSync(process.execPath, [resolve(import.meta.dirname, "prepare-squirrel.mjs")], {
    cwd: desktopRoot,
    stdio: "inherit",
  });
}

execFileSync(
  process.execPath,
  [
    forgeCli,
    mode,
    stageRoot,
    ...(mode === "make" ? ["--platform=win32", "--arch=x64"] : []),
  ],
  {
    cwd: workspaceRoot,
    env: childEnvironment,
    stdio: "inherit",
  },
);

const releaseRoot = resolve(desktopRoot, "release");
mkdirSync(releaseRoot, { recursive: true });
if (mode === "make") {
  const destination = resolve(releaseRoot, "make");
  rmSync(destination, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
  cpSync(resolve(stageRoot, "out/make"), destination, { recursive: true });
  console.log(`Windows installer artifacts: ${destination}`);
} else {
  const destination = resolve(releaseRoot, `package-${Date.now()}`);
  cpSync(resolve(stageRoot, "out"), destination, { recursive: true });
  console.log(`Packaged application: ${destination}`);
}

rmSync(stageRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
