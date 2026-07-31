import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { basename, resolve, sep } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const serverRoot = resolve(workspaceRoot, "apps/server");
const serverDataRoot = resolve(serverRoot, "data");
const uploadRoot = resolve(serverRoot, "storage/uploads");
const userDataRoot = resolve(process.env.APPDATA || "", "EnterpriseChat");
const localDataRoot = resolve(userDataRoot, "data");
const cacheRoot = resolve(userDataRoot, "cache");

function assertInside(target, root) {
  const resolvedTarget = resolve(target);
  const resolvedRoot = resolve(root);
  if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) return;
  throw new Error(`拒绝清理工作区外路径：${resolvedTarget}`);
}

function serverIsListening() {
  return new Promise((resolveListening) => {
    const socket = connect({ host: "127.0.0.1", port: 7001 });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolveListening(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolveListening(false);
    });
    socket.once("error", () => resolveListening(false));
  });
}

function removeFile(target) {
  assertInside(target, serverDataRoot);
  rmSync(target, { force: true });
}

function clearDirectory(target, root) {
  assertInside(target, root);
  if (!existsSync(target)) return;
  for (const entry of readdirSync(target)) {
    const child = resolve(target, entry);
    assertInside(child, target);
    rmSync(child, { recursive: true, force: true });
  }
}

if (basename(workspaceRoot).toLowerCase() !== "chat") {
  throw new Error(`工作区校验失败：${workspaceRoot}`);
}
if (!process.env.APPDATA) throw new Error("APPDATA 未配置，拒绝清理本地数据");
if (await serverIsListening()) {
  throw new Error("7001 端口上的服务仍在运行，请先停止 pnpm dev 后再执行 pnpm reset:data");
}

removeFile(resolve(serverDataRoot, "chat.sqlite"));
removeFile(resolve(serverDataRoot, "chat.sqlite-wal"));
removeFile(resolve(serverDataRoot, "chat.sqlite-shm"));
clearDirectory(uploadRoot, uploadRoot);
clearDirectory(localDataRoot, userDataRoot);
clearDirectory(cacheRoot, userDataRoot);
mkdirSync(uploadRoot, { recursive: true });

console.log("开发数据已清理；settings.json 已保留。");
