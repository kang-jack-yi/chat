import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import io from "socket.io-client";
import { getAccessToken } from "../services/token";
import { useServerStore } from "../stores/server-store";

const SocketContext = createContext<any>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const server = useServerStore((state) => state.server);
  const socketUrl = server?.url;
  const socket = useMemo(() => io(socketUrl, {
    path: server?.socketPath || "/socket.io",
    transports: ["websocket"],
    autoConnect: false,
    query: { token: getAccessToken() || "" },
  }), [server?.socketPath, socketUrl]);

  useEffect(() => {
    const syncToken = () => {
      (socket.io as any).opts.query = { token: getAccessToken() || "" };
    };
    syncToken();
    socket.io.on("reconnect_attempt", syncToken);
    socket.connect();
    return () => {
      socket.io.off("reconnect_attempt", syncToken);
      socket.disconnect();
    };
  }, [socket]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocketContext() {
  return useContext(SocketContext);
}
