import type { SessionData } from "@chat/shared";
import { localDatabase } from "./local-database";
import { syncService } from "./sync";
import { useServerStore } from "../stores/server-store";

export async function prepareDesktopSession(session: SessionData) {
  if (!localDatabase.available()) return;
  const server = useServerStore.getState().server;
  if (!server) throw new Error("尚未配置服务器");
  await localDatabase.open(server.serverId, session);
  const bootstrap = await syncService.bootstrapLocal();
  await syncService.incremental();
  if (bootstrap) {
    syncService.backfillHistory(bootstrap.conversations)?.catch(() => {
      void localDatabase.setState("historyComplete", "0");
    });
  }
}
