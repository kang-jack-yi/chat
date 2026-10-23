// 仅用于真实 Electron 验收，隔离用户目录后加载未经 mock 的正式主进程。
const { app } = require("electron");
const path = require("node:path");
const os = require("node:os");

const directory = path.resolve(
  process.argv.find((value) => value.startsWith("--test-data="))?.slice(12) ||
    process.env.CHAT_UI_USER_DATA ||
    "",
);
const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
if (
  !directory.toLowerCase().startsWith(temporaryRoot.toLowerCase()) ||
  !path.basename(directory).startsWith("chat-native-ui-")
) {
  throw new Error("Electron 验收必须显式指定独立临时用户目录");
}
app.setPath("userData", directory);
const rendererUrl = process.argv
  .find((value) => value.startsWith("--test-renderer="))
  ?.slice(16);
if (rendererUrl) process.env.VITE_DEV_SERVER_URL = rendererUrl;
require("../.electron/main.cjs");
