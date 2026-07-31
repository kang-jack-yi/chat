import type { Application } from "egg";
import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { resolveSession } from "./auth";

interface CollaborationContext {
  userId: number;
  companyId: number;
  permission: "owner" | "editor" | "viewer";
}

function documentIdFromName(documentName: string) {
  const match = /^document:(\d+)$/.exec(documentName);
  return match ? Number(match[1]) : null;
}

export async function startCollaborationServer(app: Application) {
  const port = Number(process.env.CHAT_COLLABORATION_PORT || 1234);
  const server = new Server<CollaborationContext>({
    port,
    name: "enterprise-chat-documents",
    quiet: true,
    debounce: 1200,
    maxDebounce: 5000,
    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          const documentId = documentIdFromName(documentName);
          if (!documentId) return null;
          const row = await app.chatDb.CloudDocument.findOne({
            where: { id: documentId, trashedAt: null },
          });
          const state = row?.get("yjsState");
          return state ? new Uint8Array(state as Buffer) : null;
        },
        store: async ({ documentName, state }) => {
          const documentId = documentIdFromName(documentName);
          if (!documentId) return;
          await app.chatDb.CloudDocument.update(
            { yjsState: Buffer.from(state) },
            { where: { id: documentId, trashedAt: null }, silent: true },
          );
        },
      }),
    ],
    async onAuthenticate({ token, documentName, connectionConfig }) {
      const documentId = documentIdFromName(documentName);
      if (!documentId) throw new Error("文档标识无效");
      const user = await resolveSession(app, token);
      if (!user) throw new Error("登录状态已失效");
      const document = await app.chatDb.CloudDocument.findOne({
        where: {
          id: documentId,
          companyId: user.companyId,
          trashedAt: null,
        },
      });
      if (!document) throw new Error("文档不存在");
      const member = await app.chatDb.CloudDocumentMember.findOne({
        where: { documentId, userId: user.id },
      });
      if (!member) throw new Error("你没有访问该文档的权限");
      const permission = String(member.get("permission")) as CollaborationContext["permission"];
      connectionConfig.readOnly = permission === "viewer";
      await member.update({ lastOpenedAt: new Date() });
      return { userId: user.id, companyId: user.companyId, permission };
    },
    async afterStoreDocument({ documentName, lastContext }) {
      const documentId = documentIdFromName(documentName);
      if (!documentId || !lastContext?.userId) return;
      await app.chatDb.CloudDocument.update(
        { lastEditorId: lastContext.userId, updatedAt: new Date() },
        { where: { id: documentId, companyId: lastContext.companyId, trashedAt: null } },
      );
    },
  });
  await server.listen(port);
  app.logger.info("[documents] Hocuspocus listening on port %s", port);
  return server;
}
