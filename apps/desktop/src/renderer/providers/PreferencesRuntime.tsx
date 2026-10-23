import { useEffect, type ReactNode } from "react";
import { useDesktopPreferences } from "../hooks/useDesktopPreferences";

/** 应用跨窗口共享的聊天密度、字体和减少动态效果偏好。 */
export default function PreferencesRuntime({
  children,
}: {
  children: ReactNode;
}) {
  const { preferences } = useDesktopPreferences();

  useEffect(() => {
    if (!preferences) return;
    const root = document.documentElement;
    root.dataset.chatDensity = preferences.chat.density;
    root.style.setProperty(
      "--chat-message-font-size",
      `${preferences.chat.fontSize}px`,
    );
    root.classList.toggle(
      "reduce-motion",
      preferences.appearance.reducedMotion,
    );
  }, [preferences]);

  return children;
}
