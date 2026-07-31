import { create } from "zustand";
import type { ServerConfig, ServerHealth } from "@chat/shared";

export type ServerStatus = "unconfigured" | "checking" | "online" | "offline";

interface ServerStore {
  server: ServerConfig | null;
  health: ServerHealth | null;
  status: ServerStatus;
  error: string;
  setChecking(): void;
  setCandidate(server: ServerConfig): void;
  setOnline(server: ServerConfig, health: ServerHealth): void;
  setOffline(error: string): void;
  reset(): void;
}

export const useServerStore = create<ServerStore>((set) => ({
  server: null,
  health: null,
  status: "unconfigured",
  error: "",
  setChecking: () => set({ status: "checking", error: "" }),
  setCandidate: (server) => set({ server }),
  setOnline: (server, health) => set({ server, health, status: "online", error: "" }),
  setOffline: (error) => set({ status: "offline", error }),
  reset: () => set({ server: null, health: null, status: "unconfigured", error: "" }),
}));
