import type { SessionData } from "@chat/shared";
import { create } from "zustand";
import { useChatDraftStore } from "./chat-draft-store";

interface UserStore {
  session: SessionData | null;
  bootstrapped: boolean;
  setSession: (session: SessionData) => void;
  setCurrentUser: (user: SessionData["user"]) => void;
  clearSession: () => void;
  setBootstrapped: (value: boolean) => void;
}

export const useUserStore = create<UserStore>((set) => ({
  session: null,
  bootstrapped: false,
  setSession: (session) => set({ session, bootstrapped: true }),
  setCurrentUser: (user) => set((state) => ({
    session: state.session ? { ...state.session, user } : null,
  })),
  clearSession: () => {
    useChatDraftStore.getState().reset();
    set({ session: null, bootstrapped: true });
  },
  setBootstrapped: (bootstrapped) => set({ bootstrapped }),
}));
