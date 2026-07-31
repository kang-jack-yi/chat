import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Message } from "@chat/shared";
import { localDatabase } from "../services/local-database";
import { post } from "../services/request";
import { queryKeys } from "../constants/query-keys";

let flushing = false;

async function flush() {
  if (!localDatabase.available() || flushing || !navigator.onLine) return;
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
      } catch (error) {
        await localDatabase.markMessage({
          clientId: item.payload.clientId,
          status: "failed",
          error: error instanceof Error ? error.message : "发送失败",
        });
      }
    }
  } finally {
    flushing = false;
  }
}

export function useOutbox() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const run = () => {
      void flush().finally(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
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
