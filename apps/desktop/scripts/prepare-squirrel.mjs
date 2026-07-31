import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const vendorRoot = resolve(workspaceRoot, "node_modules/electron-winstaller/vendor");
const hostArch = process.arch === "arm64" ? "arm64" : "x64";

copyFileSync(resolve(vendorRoot, `7z-${hostArch}.exe`), resolve(vendorRoot, "7z.exe"));
copyFileSync(resolve(vendorRoot, `7z-${hostArch}.dll`), resolve(vendorRoot, "7z.dll"));
