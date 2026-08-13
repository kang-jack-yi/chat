import { create } from "zustand";

interface AppStore {
  mobileDetailOpen: boolean;
  groupDialogOpen: boolean;
  sidebarCollapsed: boolean;
  serverSettingsOpen: boolean;
  settingsCenterOpen: boolean;
  setMobileDetailOpen: (value: boolean) => void;
  setGroupDialogOpen: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setServerSettingsOpen: (value: boolean) => void;
  setSettingsCenterOpen: (value: boolean) => void;
  reset: () => void;
}

const initialState = {
  mobileDetailOpen: false,
  groupDialogOpen: false,
  sidebarCollapsed: false,
  serverSettingsOpen: false,
  settingsCenterOpen: false,
};

export const useAppStore = create<AppStore>((set) => ({
  ...initialState,
  setMobileDetailOpen: (mobileDetailOpen) => set({ mobileDetailOpen }),
  setGroupDialogOpen: (groupDialogOpen) => set({ groupDialogOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setServerSettingsOpen: (serverSettingsOpen) => set({ serverSettingsOpen }),
  setSettingsCenterOpen: (settingsCenterOpen) => set({ settingsCenterOpen }),
  reset: () => set(initialState),
}));
