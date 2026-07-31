import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import DocumentEditorApp from "./DocumentEditorApp";
import { appTheme } from "../renderer/styles/theme";
import "antd/dist/reset.css";
import "../renderer/styles/tailwind.css";
import "../renderer/styles/global.less";
import "./style.less";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={appTheme}>
      <App>
        <DocumentEditorApp />
      </App>
    </ConfigProvider>
  </StrictMode>,
);
