module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "EnterpriseChat",
    name: "EnterpriseChat",
    ignore: [
      /^\/src/,
      /^\/out/,
      /^\/release/,
      /^\/\.forge-/,
      /^\/coverage/,
      /\.test\.(ts|tsx)$/,
      /\.tsbuildinfo$/,
    ],
  },
  rebuildConfig: {
    force: true,
    onlyModules: ["better-sqlite3"],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "EnterpriseChat",
        setupExe: "EnterpriseChat-Setup.exe",
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
  ],
};
