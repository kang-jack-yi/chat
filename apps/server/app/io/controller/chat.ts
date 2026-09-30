import { Controller } from "egg";

export default class SocketChatController extends Controller {
  /** 将 Socket 消息交给聊天 Service，保留原有成功或失败确认协议。 */
  async send() {
    const [payload, ack] = this.ctx.args || [];
    try {
      const message = await this.service.chat.sendFromSocket(payload);
      if (typeof ack === "function") ack({ success: true, data: message });
    } catch (error: any) {
      if (typeof ack === "function")
        ack({
          success: false,
          error: {
            code: error.code || "SEND_FAILED",
            message: error.message || "消息发送失败",
          },
        });
    }
  }

  /** 接收开始输入事件并转发给会话中的其他连接。 */
  async typingStart() {
    await this.emitTyping(true);
  }

  /** 接收停止输入事件并转发给会话中的其他连接。 */
  async typingStop() {
    await this.emitTyping(false);
  }

  /** 交由聊天 Service 生成输入状态，再通过 Socket 发送事件。 */
  private async emitTyping(typing: boolean) {
    const socket: any = this.ctx.socket;
    const [payload] = this.ctx.args || [];
    const event = this.service.chat.typing(socket.id, payload, typing);
    if (event)
      socket
        .to(`conversation:${event.conversationId}`)
        .emit("typing:changed", event);
  }
}
