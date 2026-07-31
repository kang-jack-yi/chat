import { useEffect, useRef, type ReactNode } from "react";
import LoadingScreen from "../components/LoadingScreen";
import { configureHttpClient } from "../services/request";
import { serverService } from "../services/server";
import { useServerStore } from "../stores/server-store";
import { useAppStore } from "../stores/app-store";
import { useUserStore } from "../stores/user-store";

function isLocalDevelopmentServer(url: string) {
  if (!import.meta.env.DEV) return false;
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function checkServerWhenReady(url: string) {
  const maximumAttempts = isLocalDevelopmentServer(url) ? 30 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      return await serverService.test(url);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < maximumAttempts) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
      }
    }
  }
  throw lastError;
}

export default function DesktopBootstrap({ children }: { children: ReactNode }) {
  const status = useServerStore((state) => state.status);
  const setChecking = useServerStore((state) => state.setChecking);
  const setCandidate = useServerStore((state) => state.setCandidate);
  const setOnline = useServerStore((state) => state.setOnline);
  const setOffline = useServerStore((state) => state.setOffline);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setChecking();
    serverService.get()
      .then(async (server) => {
        if (!server) {
          useServerStore.getState().reset();
          useUserStore.getState().clearSession();
          useAppStore.getState().setServerSettingsOpen(true);
          return;
        }
        setCandidate(server);
        configureHttpClient(server.url);
        try {
          const checked = await checkServerWhenReady(server.url);
          setOnline(checked.config, checked.health);
        } catch (error) {
          setOffline(error instanceof Error ? error.message : "服务器连接失败");
          useUserStore.getState().clearSession();
        }
      })
      .catch((error) => {
        setOffline(error instanceof Error ? error.message : "读取服务器设置失败");
        useUserStore.getState().clearSession();
        useAppStore.getState().setServerSettingsOpen(true);
      });
  }, [setCandidate, setChecking, setOffline, setOnline]);

  if (status === "checking") return <LoadingScreen />;
  return children;
}
