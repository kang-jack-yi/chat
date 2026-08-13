import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ROUTES } from "./constants/routes";
import { setUnauthorizedHandler } from "./services/request";
import { useAppStore } from "./stores/app-store";
import { useUserStore } from "./stores/user-store";
import { useSyncStore } from "./stores/sync-store";
import { applyHostAccessToken, clearAccessToken } from "./services/token";
import DesktopBootstrap from "./providers/DesktopBootstrap";
import ServerSettingsModal from "./components/ServerSettingsModal";
import SettingsCenterModal from "./components/SettingsCenterModal";
import PreferencesRuntime from "./providers/PreferencesRuntime";
import AppThemeProvider from "./providers/AppThemeProvider";
import "antd/dist/reset.css";
import "./styles/tailwind.css";
import "./styles/global.less";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const handleUnauthorized = () => {
  clearAccessToken();
  queryClient.clear();
  useUserStore.getState().clearSession();
  useAppStore.getState().reset();
  useSyncStore.getState().reset();
  if (window.location.pathname !== ROUTES.login) {
    window.history.replaceState(null, "", ROUTES.login);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
};

setUnauthorizedHandler(handleUnauthorized);
window.desktop?.auth.onTokenUpdated(applyHostAccessToken);
window.desktop?.auth.onRequired(handleUnauthorized);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreferencesRuntime>
      <AppThemeProvider>
        <BrowserRouter>
          <QueryClientProvider client={queryClient}>
            <DesktopBootstrap>
              <App />
              <ServerSettingsModal />
              <SettingsCenterModal />
            </DesktopBootstrap>
          </QueryClientProvider>
        </BrowserRouter>
      </AppThemeProvider>
    </PreferencesRuntime>
  </StrictMode>,
);
