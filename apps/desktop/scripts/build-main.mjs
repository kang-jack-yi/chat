import { build } from "esbuild";

const defaultServerUrl = process.env.DESKTOP_DEFAULT_SERVER_URL?.trim() || "";
const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/main/main.ts"],
    external: ["electron", "better-sqlite3"],
    outfile: ".electron/main.cjs",
    define: {
      __DESKTOP_DEFAULT_SERVER_URL__: JSON.stringify(defaultServerUrl),
    },
  }),
  build({
    ...shared,
    entryPoints: ["src/preload/index.ts"],
    external: ["electron"],
    outfile: ".electron/preload.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/preload/auxiliary.ts"],
    external: ["electron"],
    outfile: ".electron/auxiliary-preload.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/preload/document.ts"],
    external: ["electron"],
    outfile: ".electron/document-preload.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["../../packages/im-plugin/src/worker.ts"],
    external: ["electron", "better-sqlite3"],
    outfile: ".electron/im-plugin-worker.cjs",
  }),
]);
