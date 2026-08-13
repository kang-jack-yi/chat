import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "antd";
import DocumentEditorApp from "./DocumentEditorApp";
import AppThemeProvider from "../renderer/providers/AppThemeProvider";
import "antd/dist/reset.css";
import "../renderer/styles/tailwind.css";
import "../renderer/styles/global.less";
import "./style.less";
import PreferencesRuntime from "../renderer/providers/PreferencesRuntime";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreferencesRuntime>
      <AppThemeProvider>
        <App>
          <DocumentEditorApp />
        </App>
      </AppThemeProvider>
    </PreferencesRuntime>
  </StrictMode>,
);
