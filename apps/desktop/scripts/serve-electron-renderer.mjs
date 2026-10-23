// 原生客户端验收使用正常 Vite 入口，缓存与其他测试完全隔离。
import { createServer } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chat-native-vite-"));
const server = await createServer({
  root: path.resolve(import.meta.dirname, ".."),
  cacheDir: path.join(directory, "node_modules", ".vite"),
  server: { host: "127.0.0.1", port: 15173, strictPort: true },
});
await server.listen();
console.log("NATIVE_VITE http://127.0.0.1:15173");
console.log(`CACHE ${directory}`);
