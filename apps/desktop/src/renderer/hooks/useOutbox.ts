import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Message } from "@chat/shared";
import { localDatabase } from "../services/local-database";
import { post } from "../services/request";
import { queryKeys } from "../constants/query-keys";

let flushing = false;

async function flush() {
  const affectedConversationIds = new Set<number>();
  if (!localDatabase.available() || flushing || !navigator.onLine) {
    return affectedConversationIds;
  }
  flushing = true;
  try {
    const items = await localDatabase.getOutbox();
    for (const item of items) {
      try {
        const payload = item.payload;
        const saved = await post<Message>(`/api/conversations/${payload.conversationId}/messages`, {
          ...payload,
        });
        await localDatabase.markMessage({ clientId: payload.clientId, message: saved, status: "sent" });
        affectedConversationIds.add(payload.conversationId);
      } catch (error) {
        await localDatabase.markMessage({
          clientId: item.payload.clientId,
          status: "failed",
          error: error instanceof Error ? error.message : "发送失败",
        });
        affectedConversationIds.add(item.payload.conversationId);
      }
    }
  } finally {
    flushing = false;
  }
  return affectedConversationIds;
}

export function useOutbox() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const run = () => {
      void flush().then((conversationIds) => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
          ...[...conversationIds].map((conversationId) =>
            queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) })),
        ]);
      });
    };
    run();
    window.addEventListener("online", run);
    const timer = window.setInterval(run, 30_000);
    return () => {
      window.removeEventListener("online", run);
      window.clearInterval(timer);
    };
  }, [queryClient]);
}
