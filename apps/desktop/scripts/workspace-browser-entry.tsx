// 仅供独立工作台验收使用：复用正式页面，不注入桌面桥或模拟业务接口。
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../src/renderer/App";
import AppThemeProvider from "../src/renderer/providers/AppThemeProvider";
import PreferencesRuntime from "../src/renderer/providers/PreferencesRuntime";
import SettingsCenterModal from "../src/renderer/components/SettingsCenterModal";
import ServerSettingsModal from "../src/renderer/components/ServerSettingsModal";
import {
  configureHttpClient,
  setUnauthorizedHandler,
} from "../src/renderer/services/request";
import { authService } from "../src/renderer/services/auth";
import { clearAccessToken } from "../src/renderer/services/token";
import { useUserStore } from "../src/renderer/stores/user-store";
import { useServerStore } from "../src/renderer/stores/server-store";
import { useAppStore } from "../src/renderer/stores/app-store";
import { useSyncStore } from "../src/renderer/stores/sync-store";
import "antd/dist/reset.css";
import "../src/renderer/styles/tailwind.css";
import "../src/renderer/styles/global.less";

/** 连接隔离后端并挂载正式页面；只有显式 phone 参数才自动登录演示账号。 */
async function start() {
  const params = new URLSearchParams(location.search);
  const phone = params.get("phone");
  const route =
    params.get("route") ||
    (location.pathname.startsWith("/__workspace") || location.pathname === "/"
      ? phone
        ? "/chat"
        : "/login"
      : `${location.pathname}${location.search}`);
  configureHttpClient(location.origin);
  const response = await fetch("/api/health");
  const health = await response.json();
  if (!response.ok || !health.success) throw new Error("隔离后端健康检查失败");
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
  if (phone) {
    useUserStore
      .getState()
      .setSession(await authService.login({ phone, password: "123456" }));
  }
  history.replaceState(null, "", route);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
  /** 复用正式入口的会话过期清理语义，不泄漏认证令牌。 */
  function handleUnauthorized() {
    clearAccessToken();
    queryClient.clear();
    useUserStore.getState().clearSession();
    useAppStore.getState().reset();
    useSyncStore.getState().reset();
    if (location.pathname !== "/login") {
      history.replaceState(null, "", "/login");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }
  setUnauthorizedHandler(handleUnauthorized);
  createRoot(document.getElementById("root")!).render(
    <PreferencesRuntime>
      <AppThemeProvider>
        <BrowserRouter>
          <QueryClientProvider client={queryClient}>
            <App />
            <ServerSettingsModal />
            <SettingsCenterModal />
          </QueryClientProvider>
        </BrowserRouter>
      </AppThemeProvider>
    </PreferencesRuntime>,
  );
}

void start().catch((error: Error) => {
  document.body.textContent = `工作台验收初始化失败：${error.message}`;
  // 将入口初始化失败同时交给浏览器的未捕获异常监听器。
  window.setTimeout(() => {
    throw error;
  });
});
