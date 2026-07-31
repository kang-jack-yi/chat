import { create } from "zustand";
import type { SyncStatus } from "@chat/shared";

interface SyncStore {
  status: SyncStatus;
  setStatus(status: Partial<SyncStatus>): void;
  reset(): void;
}

const initialStatus: SyncStatus = {
  cursor: 0,
  minimumCursor: 0,
  maximumCursor: 0,
  historyComplete: false,
  phase: "idle",
};

export const useSyncStore = create<SyncStore>((set) => ({
  status: initialStatus,
  setStatus: (status) => set((state) => ({ status: { ...state.status, ...status } })),
  reset: () => set({ status: initialStatus }),
}));
