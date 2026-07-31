import type { Conversation, Message, SyncBootstrap, SyncEventPage, SyncStatus } from "@chat/shared";
import { get } from "./request";
import { localDatabase } from "./local-database";
import type { MessagePage } from "../types/api";
import { useSyncStore } from "../stores/sync-store";

let historyTask: Promise<void> | null = null;
let incrementalTask: Promise<number> | null = null;

function report(status: Partial<SyncStatus>) {
  useSyncStore.getState().setStatus(status);
  void window.desktop?.sync.report(useSyncStore.getState().status);
}

export const syncService = {
  bootstrap: () => get<SyncBootstrap>("/api/sync/bootstrap"),
  events: (cursor: number) => get<SyncEventPage>(`/api/sync/events?cursor=${cursor}&limit=500`),
  status: () => get<SyncStatus>("/api/sync/status"),
  async bootstrapLocal() {
    if (!localDatabase.available()) return null;
    report({ phase: "bootstrap", message: "正在同步工作区快照" });
    try {
      const bootstrap = await this.bootstrap();
      await localDatabase.applyBootstrap(bootstrap);
      report({ cursor: bootstrap.cursor, maximumCursor: bootstrap.cursor, phase: "idle", message: "" });
      return bootstrap;
    } catch (error) {
      report({ phase: "error", message: error instanceof Error ? error.message : "同步失败" });
      throw error;
    }
  },
  async incremental() {
    if (!localDatabase.available()) return 0;
    if (incrementalTask) return incrementalTask;
    incrementalTask = (async () => {
      report({ phase: "incremental", message: "正在同步最新消息" });
      let cursor = await localDatabase.getCursor();
      for (;;) {
        const page = await this.events(cursor);
        if (page.events.length) {
          await localDatabase.applyEvents(page.events);
          if (page.events.some((event) =>
            event.type === "conversation.upsert" || event.type === "conversation.delete")) {
            const conversations = await get<Conversation[]>("/api/conversations?includeHidden=1");
            await localDatabase.replaceConversations(conversations);
          }
        }
        cursor = page.nextCursor;
        report({ cursor, maximumCursor: cursor });
        if (!page.hasMore) return cursor;
      }
    })().then((cursor) => {
      report({ phase: historyTask ? "history" : "idle", message: historyTask ? "正在补齐完整历史" : "" });
      return cursor;
    }).catch((error) => {
      report({ phase: "error", message: error instanceof Error ? error.message : "增量同步失败" });
      throw error;
    }).finally(() => {
      incrementalTask = null;
    });
    return incrementalTask;
  },
  backfillHistory(conversations: Conversation[]) {
    if (!localDatabase.available() || historyTask) return historyTask;
    historyTask = (async () => {
      await localDatabase.setState("historyComplete", "0");
      report({ phase: "history", historyComplete: false, message: "正在补齐完整历史" });
      for (let index = 0; index < conversations.length; index += 1) {
        const conversation = conversations[index];
        report({ message: `正在补齐历史 ${index + 1}/${conversations.length}` });
        let before: number | undefined;
        for (;;) {
          const query = new URLSearchParams({ limit: "100" });
          if (before) query.set("beforeId", String(before));
          const page = await get<MessagePage<Message>>(
            `/api/conversations/${conversation.id}/messages?${query}`,
          );
          if (page.items.length) await localDatabase.upsertMessages(page.items);
          if (!page.nextCursor) break;
          before = page.nextCursor;
        }
      }
      await localDatabase.setState("historyComplete", "1");
      report({ phase: "idle", historyComplete: true, message: "" });
    })().catch((error) => {
      report({ phase: "error", historyComplete: false, message: error instanceof Error ? error.message : "历史同步失败" });
      throw error;
    }).finally(() => {
      historyTask = null;
    });
    return historyTask;
  },
};
