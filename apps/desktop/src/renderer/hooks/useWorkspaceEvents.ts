import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Message, User } from "@chat/shared";
import { queryKeys } from "../constants/query-keys";
import { useSocket } from "./useSocket";
import { localDatabase } from "../services/local-database";
import { syncService } from "../services/sync";

export function useWorkspaceEvents() {
  const socket = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;
    const refreshConversations = () => queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    const refreshUsers = () => queryClient.invalidateQueries({ queryKey: queryKeys.users });
    const refreshNotifications = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
    const onPresence = ({ userId, online }: { userId: number; online: boolean }) => {
      queryClient.setQueryData<User[]>(queryKeys.users, (old) =>
        old?.map((user) => user.id === userId ? { ...user, online } : user));
    };
    const persistMessage = (message: Message) => {
      if (localDatabase.available()) void localDatabase.upsertMessages([message]);
    };
    const synchronize = async () => {
      if (!localDatabase.available()) return;
      await syncService.incremental();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
        queryClient.invalidateQueries({ queryKey: queryKeys.users }),
        queryClient.invalidateQueries({ queryKey: queryKeys.departments }),
      ]);
    };
    socket.on("conversation:updated", refreshConversations);
    socket.on("unread:updated", refreshConversations);
    socket.on("presence:changed", onPresence);
    socket.on("member:status-changed", refreshUsers);
    socket.on("notification:available", refreshNotifications);
    socket.on("message:new", persistMessage);
    socket.on("sync:available", synchronize);
    const unsubscribeRetry = window.desktop?.sync.onRetry(() => {
      void synchronize();
    });
    return () => {
      socket.off("conversation:updated", refreshConversations);
      socket.off("unread:updated", refreshConversations);
      socket.off("presence:changed", onPresence);
      socket.off("member:status-changed", refreshUsers);
      socket.off("notification:available", refreshNotifications);
      socket.off("message:new", persistMessage);
      socket.off("sync:available", synchronize);
      unsubscribeRetry?.();
    };
  }, [socket, queryClient]);
}
