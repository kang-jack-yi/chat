import type { DesktopPreferences } from "@chat/shared";
import { create } from "zustand";

interface PreferencesStore {
  preferences: DesktopPreferences | null;
  loading: boolean;
  setPreferences: (preferences: DesktopPreferences) => void;
  setLoading: (loading: boolean) => void;
}

export const usePreferencesStore = create<PreferencesStore>((set) => ({
  preferences: null,
  loading: true,
  setPreferences: (preferences) => set({ preferences, loading: false }),
  setLoading: (loading) => set({ loading }),
}));
