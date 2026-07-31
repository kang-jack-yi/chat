import type { SessionData } from "@chat/shared";
import { create } from "zustand";
import { useChatDraftStore } from "./chat-draft-store";

interface UserStore {
  session: SessionData | null;
  bootstrapped: boolean;
  setSession: (session: SessionData) => void;
  clearSession: () => void;
  setBootstrapped: (value: boolean) => void;
}

export const useUserStore = create<UserStore>((set) => ({
  session: null,
  bootstrapped: false,
  setSession: (session) => set({ session, bootstrapped: true }),
  clearSession: () => {
    useChatDraftStore.getState().reset();
    set({ session: null, bootstrapped: true });
  },
  setBootstrapped: (bootstrapped) => set({ bootstrapped }),
}));
