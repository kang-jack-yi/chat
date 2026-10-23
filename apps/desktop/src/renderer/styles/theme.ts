import type { ThemeConfig } from "antd";

export const appTheme: ThemeConfig = {
  cssVar: {},
  algorithm: undefined,
  token: {
    colorPrimary: "#4263eb",
    colorPrimaryHover: "#3654d4",
    colorPrimaryActive: "#2d46b5",
    colorInfo: "#4263eb",
    colorSuccess: "#19966d",
    colorWarning: "#d99024",
    colorError: "#dc5368",
    colorText: "#202939",
    colorTextSecondary: "#657087",
    colorTextTertiary: "#657084",
    colorBorder: "#dbe3ec",
    colorBorderSecondary: "#e3e8ef",
    colorBgLayout: "#f5f7fb",
    colorBgContainer: "#ffffff",
    controlHeight: 36,
    controlHeightSM: 30,
    controlHeightLG: 44,
    fontSize: 13,
    borderRadius: 9,
    borderRadiusLG: 14,
    boxShadowSecondary: "0 18px 48px rgba(24,34,48,.13)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Button: {
      borderRadius: 9,
      fontWeight: 550,
    },
    Card: {
      borderRadiusLG: 14,
    },
    Input: {
      activeBorderColor: "#4263eb",
      hoverBorderColor: "#9baaf4",
      activeShadow: "0 0 0 3px rgba(47,107,255,.10)",
    },
    Modal: {
      borderRadiusLG: 16,
      paddingContentHorizontalLG: 24,
    },
    Select: {
      optionSelectedBg: "#edf1ff",
      optionActiveBg: "#f5f7fb",
      optionSelectedFontWeight: 600,
    },
    Table: {
      headerBg: "#f8fafc",
      headerColor: "#5d6b7a",
      rowHoverBg: "#f1f5fb",
      cellPaddingBlock: 14,
      cellPaddingInline: 18,
    },
    Tabs: {
      itemSelectedColor: "#4263eb",
      itemHoverColor: "#3654d4",
      inkBarColor: "#4263eb",
    },
  },
};
