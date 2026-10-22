// 仅供 verify-document-reviews.mjs 的真实页面验收，不在发布入口中加载。
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../src/renderer/App";
import AppThemeProvider from "../src/renderer/providers/AppThemeProvider";
import { configureHttpClient } from "../src/renderer/services/request";
import { authService } from "../src/renderer/services/auth";
import { useUserStore } from "../src/renderer/stores/user-store";
import { useServerStore } from "../src/renderer/stores/server-store";
import { usePreferencesStore } from "../src/renderer/stores/preferences-store";
import "antd/dist/reset.css";
import "../src/renderer/styles/tailwind.css";
import "../src/renderer/styles/global.less";

/** 仅通过隔离测试服务登录演示账号，然后挂载正式 App，不模拟业务接口或页面。 */
async function start() {
  const params = new URLSearchParams(location.search);
  const phone = params.get("phone") || "13800000001";
  const route = params.get("route") || "/documents";
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  usePreferencesStore.getState().setPreferences({
    appearance: { theme, zoom: 1, reducedMotion: true },
    chat: { sendKey: "enter", fontSize: 14, density: "comfortable" },
    general: {
      launchAtLogin: false,
      closeToTray: false,
      downloadDirectory: null,
    },
  });
  document.documentElement.dataset.theme = theme;
  configureHttpClient(location.origin);
  const session = await authService.login({ phone, password: "123456" });
  const health = await fetch("/api/health").then((response) => response.json());
  useServerStore.getState().setOnline(
    {
      url: location.origin,
      serverId: health.data.serverId,
      name: health.data.name,
      socketPath: "/socket.io",
      apiVersion: health.data.apiVersion,
    },
    health.data,
  );
  useUserStore.getState().setSession(session);
  history.replaceState(null, "", route);
  createRoot(document.getElementById("root")!).render(
    <AppThemeProvider>
      <BrowserRouter>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false, staleTime: 0 } },
            })
          }
        >
          <App />
        </QueryClientProvider>
      </BrowserRouter>
    </AppThemeProvider>,
  );
}

void start().catch((error) => {
  document.body.textContent = error.message;
});
