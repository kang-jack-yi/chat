import type { ThemeConfig } from "antd";

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: "#1677ff",
    colorPrimaryHover: "#0b65d8",
    colorPrimaryActive: "#0958b8",
    colorInfo: "#1677ff",
    colorSuccess: "#1ca777",
    colorWarning: "#e9a23b",
    colorError: "#e85d75",
    colorText: "#1f2733",
    colorTextSecondary: "#6b7785",
    colorTextTertiary: "#98a2ad",
    colorBorder: "#d8e2ee",
    colorBorderSecondary: "#e1e6ed",
    colorBgLayout: "#f2f5fa",
    colorBgContainer: "#ffffff",
    borderRadius: 11,
    borderRadiusLG: 16,
    boxShadowSecondary: "0 18px 55px rgba(39,48,67,.14)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Button: {
      borderRadius: 11,
      fontWeight: 550,
    },
    Card: {
      borderRadiusLG: 16,
    },
    Input: {
      activeBorderColor: "#1677ff",
      hoverBorderColor: "#79afff",
      activeShadow: "0 0 0 3px rgba(22,119,255,.10)",
    },
    Modal: {
      borderRadiusLG: 20,
      paddingContentHorizontalLG: 24,
    },
    Select: {
      optionSelectedBg: "transparent",
      optionActiveBg: "transparent",
      optionSelectedFontWeight: 600,
    },
    Table: {
      headerBg: "#f8fafc",
      headerColor: "#5f6c7a",
      rowHoverBg: "#f1f7ff",
    },
    Tabs: {
      itemSelectedColor: "#1677ff",
      itemHoverColor: "#0b65d8",
      inkBarColor: "#1677ff",
    },
  },
};
