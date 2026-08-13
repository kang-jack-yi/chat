import { ConfigProvider, theme as antdTheme, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePreferencesStore } from "../stores/preferences-store";
import { appTheme } from "../styles/theme";

export default function AppThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const mode = usePreferencesStore(
    (state) => state.preferences?.appearance.theme,
  );
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const dark = mode === "dark" || (mode === "system" && systemDark);
  const config = useMemo<ThemeConfig>(
    () => ({
      ...appTheme,
      algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        ...appTheme.token,
        ...(dark
          ? {
              colorPrimary: "#5b9aff",
              colorPrimaryHover: "#70aaff",
              colorPrimaryActive: "#5793e8",
              colorInfo: "#5b9aff",
              colorSuccess: "#55bd8a",
              colorWarning: "#e9b45d",
              colorError: "#ff7a8a",
              colorText: "#f1f3f5",
              colorTextSecondary: "#b7bcc4",
              colorTextTertiary: "#949aa3",
              colorBorder: "#36383d",
              colorBorderSecondary: "#36383d",
              colorBgLayout: "#18191b",
              colorBgContainer: "#202124",
              colorBgElevated: "#252629",
              colorFillSecondary: "#2d2f33",
              colorFillTertiary: "#292a2e",
            }
          : {}),
      },
      components: {
        ...appTheme.components,
        Table: {
          ...appTheme.components?.Table,
          ...(dark
            ? {
                headerBg: "#252629",
                headerColor: "#b7bcc4",
                rowHoverBg: "#2d2f33",
              }
            : {}),
        },
      },
    }),
    [dark],
  );
  return (
    <ConfigProvider locale={zhCN} theme={config}>
      {children}
    </ConfigProvider>
  );
}
