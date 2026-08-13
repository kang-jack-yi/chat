import { useEffect, type ReactNode } from "react";
import { useDesktopPreferences } from "../hooks/useDesktopPreferences";

export default function PreferencesRuntime({ children }: { children: ReactNode }) {
  const { preferences } = useDesktopPreferences();

  useEffect(() => {
    if (!preferences) return;
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = preferences.appearance.theme === "dark"
        || (preferences.appearance.theme === "system" && media.matches);
      root.dataset.theme = dark ? "dark" : "light";
      root.dataset.chatDensity = preferences.chat.density;
      root.style.setProperty("--chat-message-font-size", `${preferences.chat.fontSize}px`);
      root.classList.toggle("reduce-motion", preferences.appearance.reducedMotion);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences]);

  return children;
}
