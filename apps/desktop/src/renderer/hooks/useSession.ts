import { useEffect, useRef } from "react";
import { authService } from "../services/auth";
import { ApiError } from "../services/request";
import { useUserStore } from "../stores/user-store";
import { useServerStore } from "../stores/server-store";
import { prepareDesktopSession } from "../services/desktop-session";

export function useSession() {
  const session = useUserStore((state) => state.session);
  const bootstrapped = useUserStore((state) => state.bootstrapped);
  const setSession = useUserStore((state) => state.setSession);
  const clearSession = useUserStore((state) => state.clearSession);
  const started = useRef(false);
  const serverStatus = useServerStore((state) => state.status);

  useEffect(() => {
    if (serverStatus !== "online" || bootstrapped || started.current) return;
    started.current = true;
    authService.me()
      .then(async (nextSession) => {
        await prepareDesktopSession(nextSession);
        setSession(nextSession);
      })
      .catch((error) => {
        if (!(error instanceof ApiError && error.status === 401)) console.error(error);
        clearSession();
      });
  }, [bootstrapped, clearSession, serverStatus, setSession]);

  return { session, bootstrapped };
}
