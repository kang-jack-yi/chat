import { Controller } from "egg";
import { createMessage } from "../../lib/chat";

export default class SocketChatController extends Controller {
  async send() {
    const socket: any = this.ctx.socket;
    const [payload, ack] = this.ctx.args || [];
    const user = this.ctx.currentUser;
    try {
      if (!user) throw Object.assign(new Error("登录状态已失效，请重新连接"), { code: "UNAUTHORIZED" });
      const message = await createMessage(this.app, user, payload);
      this.app.io.of("/").to(`conversation:${message.conversationId}`).emit("message:new", message);
      this.app.io.of("/").to(`conversation:${message.conversationId}`).emit("sync:available", {
        conversationId: message.conversationId,
      });
      if (typeof ack === "function") ack({ success: true, data: message });
    } catch (error: any) {
      if (typeof ack === "function") ack({ success: false, error: { code: error.code || "SEND_FAILED", message: error.message || "消息发送失败" } });
    }
  }

  async typingStart() {
    await this.emitTyping(true);
  }

  async typingStop() {
    await this.emitTyping(false);
  }

  private async emitTyping(typing: boolean) {
    const socket: any = this.ctx.socket;
    const [payload] = this.ctx.args || [];
    const user = (this.app as any).socketUsers?.get(socket.id) || {
      id: Number(payload?.userId),
      name: String(payload?.name || ""),
    };
    const conversationId = Number(payload?.conversationId);
    if (!conversationId || !user.id || !user.name) return;
    socket.to(`conversation:${conversationId}`).emit("typing:changed", {
      conversationId,
      userId: user.id,
      name: user.name,
      typing,
    });
  }
}
