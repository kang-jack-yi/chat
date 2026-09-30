import type { Application } from "egg";
import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { resolveSession } from "./auth";

interface CollaborationContext {
  userId: number;
  companyId: number;
  permission: "owner" | "editor" | "viewer";
}

/** 将协作文档名称解析为业务文档标识。 */
function documentIdFromName(documentName: string) {
  const match = /^document:(\d+)$/.exec(documentName);
  return match ? Number(match[1]) : null;
}

/** 启动带权限鉴权和版本持久化的文档协作服务器。 */
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
        /** 加载当前协作状态，恢复期间拒绝建立新的旧状态实例。 */
        fetch: async ({ documentName }) => {
          const documentId = documentIdFromName(documentName);
          if (!documentId) return null;
          if (app.documentRestores?.has(documentId))
            throw new Error("文档正在恢复，请稍后重试");
          const row = await app.chatDb.CloudDocument.findOne({
            where: { id: documentId, trashedAt: null },
          });
          const state = row?.get("yjsState");
          return state ? new Uint8Array(state as Buffer) : null;
        },
        /** 委托业务层在同一事务中保存协作内容及历史版本。 */
        store: async ({ documentName, state, lastContext }) => {
          const documentId = documentIdFromName(documentName);
          if (!documentId) return;
          await app
            .createAnonymousContext()
            .service.documentVersions.persistCollaboration(
              documentId,
              Buffer.from(state),
              lastContext?.userId,
            );
        },
      }),
    ],
    /** 校验会话及文档权限，并在异步鉴权结束后再次检查恢复保护。 */
    async onAuthenticate({ token, documentName, connectionConfig }) {
      const documentId = documentIdFromName(documentName);
      if (!documentId) throw new Error("文档标识无效");
      if (app.documentRestores?.has(documentId))
        throw new Error("文档正在恢复，请稍后重试");
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
      const permission = String(
        member.get("permission"),
      ) as CollaborationContext["permission"];
      connectionConfig.readOnly = permission === "viewer";
      await member.update({ lastOpenedAt: new Date() });
      if (app.documentRestores?.has(documentId))
        throw new Error("文档正在恢复，请稍后重试");
      return { userId: user.id, companyId: user.companyId, permission };
    },
  });
  await server.listen(port);
  app.logger.info("[documents] Hocuspocus listening on port %s", port);
  return server;
}
