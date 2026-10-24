import type { Message } from "@chat/shared";

/** 仅将同一发送者、时间正序且间隔不足五分钟的普通消息接续显示。 */
export function continuesMessageGroup(
  previous: Message | undefined,
  message: Message,
): boolean {
  if (
    !previous ||
    previous.kind !== "user" ||
    message.kind !== "user" ||
    previous.senderId !== message.senderId ||
    previous.senderType !== message.senderType
  ) {
    return false;
  }
  // 机器人共用 senderId=0，必须有相同的 bot 身份才能省略头像和名称。
  if (
    message.senderType === "bot" &&
    (message.senderBotId == null ||
      previous.senderBotId !== message.senderBotId)
  ) {
    return false;
  }
  const gap = Date.parse(message.createdAt) - Date.parse(previous.createdAt);
  return gap >= 0 && gap < 5 * 60 * 1000;
}
