import { ConfigProvider, theme as antdTheme, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePreferencesStore } from "../stores/preferences-store";
import { appTheme } from "../styles/theme";

/** 生成所有 React 根共用的主题，包含系统外观变化。 */
function useAppThemeConfig(): ThemeConfig {
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
  const dark = mode === "dark" || ((!mode || mode === "system") && systemDark);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  const config = useMemo<ThemeConfig>(
    () => ({
      ...appTheme,
      algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        ...appTheme.token,
        ...(dark
          ? {
              colorPrimary: "#91a7ff",
              colorPrimaryHover: "#b0bfff",
              colorPrimaryActive: "#748df0",
              colorPrimaryBg: "#2d323b",
              colorPrimaryBgHover: "#343a43",
              colorInfo: "#91a7ff",
              colorInfoBg: "#24282e",
              colorInfoBgHover: "#2e333b",
              colorInfoBorder: "#414852",
              colorSuccess: "#55bd8a",
              colorWarning: "#e9b45d",
              colorError: "#ff7a8a",
              colorText: "#eceef1",
              colorTextSecondary: "#b1b6bf",
              colorTextTertiary: "#949ba7",
              colorBorder: "#414852",
              colorBorderSecondary: "#353b43",
              colorBgLayout: "#141619",
              colorBgContainer: "#1c1f24",
              colorBgElevated: "#24282e",
              colorFillSecondary: "#2e333b",
              colorFillTertiary: "#292d34",
              controlItemBgActive: "#343a43",
              controlItemBgHover: "#2e333b",
            }
          : {}),
      },
      components: {
        ...appTheme.components,
        Button: {
          ...appTheme.components?.Button,
          ...(dark
            ? {
                colorPrimary: "#4c66bb",
                colorPrimaryHover: "#6079cc",
                colorPrimaryActive: "#435aab",
                primaryColor: "#ffffff",
              }
            : {}),
        },
        Table: {
          ...appTheme.components?.Table,
          ...(dark
            ? {
                headerBg: "#24282e",
                headerColor: "#b1b6bf",
                rowHoverBg: "#2e333b",
                rowSelectedBg: "#2d323b",
                rowSelectedHoverBg: "#343a43",
              }
            : {}),
        },
        Select: {
          ...appTheme.components?.Select,
          ...(dark
            ? { optionSelectedBg: "#343a43", optionActiveBg: "#2e333b" }
            : {}),
        },
        Tabs: {
          ...appTheme.components?.Tabs,
          ...(dark
            ? {
                itemSelectedColor: "#eceef1",
                itemHoverColor: "#eceef1",
                inkBarColor: "#91a7ff",
              }
            : {}),
        },
        Segmented: {
          ...(dark
            ? {
                itemSelectedBg: "#3a404a",
                itemSelectedColor: "#eceef1",
                trackBg: "#24282e",
              }
            : {}),
        },
        DatePicker: {
          ...(dark
            ? {
                colorPrimary: "#555e6b",
                colorTextLightSolid: "#ffffff",
                cellActiveWithRangeBg: "#343a43",
                cellHoverWithRangeBg: "#2e333b",
                cellHoverBg: "#2e333b",
                cellRangeBorderColor: "#75808f",
              }
            : {}),
        },
        Checkbox: {
          ...(dark
            ? { colorPrimary: "#4c66bb", colorPrimaryHover: "#6079cc" }
            : {}),
        },
        Radio: {
          ...(dark
            ? {
                colorPrimary: "#4c66bb",
                colorPrimaryHover: "#6079cc",
                buttonSolidCheckedBg: "#3a404a",
                buttonSolidCheckedHoverBg: "#464d58",
                buttonSolidCheckedActiveBg: "#343a43",
                buttonSolidCheckedColor: "#eceef1",
              }
            : {}),
        },
        Switch: {
          ...(dark
            ? { colorPrimary: "#4c66bb", colorPrimaryHover: "#6079cc" }
            : {}),
        },
      },
    }),
    [dark],
  );
  return config;
}

/** 静态确认弹窗与消息提示也订阅主题，避免脱离主 React 根后退回默认配色。 */
function StaticThemeProvider({ children }: { children: ReactNode }) {
  const config = useAppThemeConfig();
  return (
    <ConfigProvider locale={zhCN} theme={config}>
      {children}
    </ConfigProvider>
  );
}

/** 统一主窗口、独立窗口和静态弹窗的组件主题。 */
export default function AppThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const config = useAppThemeConfig();
  useLayoutEffect(() => {
    ConfigProvider.config({
      holderRender: (content) => (
        <StaticThemeProvider>{content}</StaticThemeProvider>
      ),
    });
    return () => ConfigProvider.config({ holderRender: undefined });
  }, []);
  return (
    <ConfigProvider locale={zhCN} theme={config}>
      {children}
    </ConfigProvider>
  );
}
