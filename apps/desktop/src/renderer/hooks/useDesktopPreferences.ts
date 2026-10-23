import type {
  DesktopPreferences,
  DesktopPreferencesUpdate,
} from "@chat/shared";
import { useCallback, useEffect } from "react";
import { usePreferencesStore } from "../stores/preferences-store";

const browserThemeKey = "tongpin.appearance.theme";

/** 为浏览器预览提供基础偏好；桌面客户端仍由主进程持久化。 */
function browserPreferences(): DesktopPreferences {
  let theme: DesktopPreferences["appearance"]["theme"] = "system";
  try {
    const stored = localStorage.getItem(browserThemeKey);
    if (stored === "light" || stored === "dark" || stored === "system")
      theme = stored;
  } catch {
    // 禁用站点存储时仍可在当前窗口切换外观。
  }
  return {
    appearance: { theme, zoom: 1, reducedMotion: false },
    chat: { sendKey: "enter", fontSize: 14, density: "comfortable" },
    general: {
      launchAtLogin: false,
      closeToTray: false,
      downloadDirectory: null,
    },
  };
}

/** 读取跨窗口桌面偏好，并允许无原生桥接的预览切换主题。 */
export function useDesktopPreferences() {
  const preferences = usePreferencesStore((state) => state.preferences);
  const loading = usePreferencesStore((state) => state.loading);
  const setPreferences = usePreferencesStore((state) => state.setPreferences);

  useEffect(() => {
    const bridge =
      window.desktop?.preferences ||
      window.auxiliary?.preferences ||
      window.documentDesktop?.preferences;
    if (!bridge) {
      if (!usePreferencesStore.getState().preferences)
        setPreferences(browserPreferences());
      const syncBrowserTheme = (event: StorageEvent) => {
        if (event.key !== browserThemeKey) return;
        const current =
          usePreferencesStore.getState().preferences || browserPreferences();
        setPreferences({
          ...current,
          appearance: {
            ...current.appearance,
            theme: browserPreferences().appearance.theme,
          },
        });
      };
      window.addEventListener("storage", syncBrowserTheme);
      return () => window.removeEventListener("storage", syncBrowserTheme);
    }
    void bridge.get().then(setPreferences);
    return bridge.onChanged(setPreferences);
  }, [setPreferences]);

  const update = useCallback(
    async (input: DesktopPreferencesUpdate) => {
      const current =
        usePreferencesStore.getState().preferences || browserPreferences();
      const next = window.desktop?.preferences
        ? await window.desktop.preferences.update(input)
        : {
            appearance: { ...current.appearance, ...input.appearance },
            general: { ...current.general, ...input.general },
            chat: { ...current.chat, ...input.chat },
          };
      if (!window.desktop?.preferences && input.appearance?.theme) {
        try {
          localStorage.setItem(browserThemeKey, next.appearance.theme);
        } catch {
          // 不允许持久化时保留当前窗口的偏好。
        }
      }
      setPreferences(next);
      return next;
    },
    [setPreferences],
  );

  return { preferences, loading, update };
}
