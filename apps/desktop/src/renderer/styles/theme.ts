import type { ThemeConfig } from "antd";

export const appTheme: ThemeConfig = {
  cssVar: {},
  algorithm: undefined,
  token: {
    colorPrimary: "#2f6bff",
    colorPrimaryHover: "#2458d8",
    colorPrimaryActive: "#1e47b6",
    colorInfo: "#2f6bff",
    colorSuccess: "#19966d",
    colorWarning: "#d99024",
    colorError: "#dc5368",
    colorText: "#182230",
    colorTextSecondary: "#607080",
    colorTextTertiary: "#98a2b3",
    colorBorder: "#dbe3ec",
    colorBorderSecondary: "#e3e8ef",
    colorBgLayout: "#f3f5f8",
    colorBgContainer: "#ffffff",
    borderRadius: 10,
    borderRadiusLG: 14,
    boxShadowSecondary: "0 18px 48px rgba(24,34,48,.13)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Button: {
      borderRadius: 10,
      fontWeight: 550,
    },
    Card: {
      borderRadiusLG: 14,
    },
    Input: {
      activeBorderColor: "#2f6bff",
      hoverBorderColor: "#8aabff",
      activeShadow: "0 0 0 3px rgba(47,107,255,.10)",
    },
    Modal: {
      borderRadiusLG: 16,
      paddingContentHorizontalLG: 24,
    },
    Select: {
      optionSelectedBg: "transparent",
      optionActiveBg: "transparent",
      optionSelectedFontWeight: 600,
    },
    Table: {
      headerBg: "#f8fafc",
      headerColor: "#5d6b7a",
      rowHoverBg: "#f1f5fb",
    },
    Tabs: {
      itemSelectedColor: "#2f6bff",
      itemHoverColor: "#2458d8",
      inkBarColor: "#2f6bff",
    },
  },
};
