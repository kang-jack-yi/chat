import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppStore {
  mobileDetailOpen: boolean;
  groupDialogOpen: boolean;
  sidebarCollapsed: boolean | null;
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
  serverSettingsOpen: false,
  settingsCenterOpen: false,
};

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      ...initialState,
      // 未手动选择时跟随窗口宽度，选择后保持用户的布局偏好。
      sidebarCollapsed: null,
      setMobileDetailOpen: (mobileDetailOpen) => set({ mobileDetailOpen }),
      setGroupDialogOpen: (groupDialogOpen) => set({ groupDialogOpen }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setServerSettingsOpen: (serverSettingsOpen) =>
        set({ serverSettingsOpen }),
      setSettingsCenterOpen: (settingsCenterOpen) =>
        set({ settingsCenterOpen }),
      // 退出账号只清理临时界面状态，保留本机导航偏好。
      reset: () => set(initialState),
    }),
    {
      name: "tongpin.workspace-layout",
      partialize: ({ sidebarCollapsed }) => ({ sidebarCollapsed }),
    },
  ),
);
