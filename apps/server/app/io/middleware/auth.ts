import type { Context } from "egg";
import { resolveSession } from "../../lib/auth";

export default () => async (ctx: Context, next: () => Promise<any>) => {
  const socket: any = ctx.socket;
  const authorization = String(socket.handshake?.headers?.authorization || "");
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || socket.handshake?.auth?.token || socket.handshake?.query?.token;
  const user = await resolveSession(ctx.app, token);
  if (!user) {
    socket.disconnect(true);
    return;
  }
  socket.currentUser = user;
  socket.request.currentUser = user;
  (ctx.req as any).currentUser = user;
  socket.join(`company:${user.companyId}`);
  socket.join(`user:${user.id}`);
  const memberships = await ctx.app.chatDb.ConversationMember.findAll({ where: { userId: user.id, leftAt: null } });
  memberships.forEach((m: any) => socket.join(`conversation:${m.get("conversationId")}`));
  const app: any = ctx.app;
  app.onlineUsers ||= new Set<number>();
  app.socketUsers ||= new Map<string, any>();
  app.socketUsers.set(socket.id, user);
  app.onlineUsers.add(user.id);
  ctx.app.io.of("/").to(`company:${user.companyId}`).emit("presence:changed", { userId: user.id, online: true });
  socket.on("disconnect", () => {
    app.socketUsers.delete(socket.id);
    app.onlineUsers.delete(user.id);
    ctx.app.io.of("/").to(`company:${user.companyId}`).emit("presence:changed", { userId: user.id, online: false });
  });
  await next();
};
