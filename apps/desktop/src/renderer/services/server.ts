import type { ServerConfig, ServerHealth } from "@chat/shared";

export interface CheckedServer {
  config: ServerConfig;
  health: ServerHealth;
}

function bridge() {
  if (!window.desktop) throw new Error("Electron DesktopBridge 不可用");
  return window.desktop;
}

export const serverService = {
  async get(): Promise<ServerConfig | null> {
    return bridge().server.get();
  },
  test(url: string) {
    return bridge().server.test(url);
  },
  switch(url: string) {
    return bridge().server.switch(url);
  },
};
