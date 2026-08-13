import type { DesktopPreferences } from "@chat/shared";
import { useCallback, useEffect } from "react";
import { usePreferencesStore } from "../stores/preferences-store";

export function useDesktopPreferences() {
  const preferences = usePreferencesStore((state) => state.preferences);
  const loading = usePreferencesStore((state) => state.loading);
  const setPreferences = usePreferencesStore((state) => state.setPreferences);

  useEffect(() => {
    const bridge = window.desktop?.preferences
      || window.auxiliary?.preferences
      || window.documentDesktop?.preferences;
    if (!bridge) return;
    void bridge.get().then(setPreferences);
    return bridge.onChanged(setPreferences);
  }, [setPreferences]);

  const update = useCallback(async (input: {
    appearance?: Partial<DesktopPreferences["appearance"]>;
    general?: Partial<DesktopPreferences["general"]>;
    chat?: Partial<DesktopPreferences["chat"]>;
  }) => {
    if (!window.desktop?.preferences) return null;
    const next = await window.desktop.preferences.update(input);
    setPreferences(next);
    return next;
  }, [setPreferences]);

  return { preferences, loading, update };
}
