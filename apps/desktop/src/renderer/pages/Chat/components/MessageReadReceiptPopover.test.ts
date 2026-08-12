import { describe, expect, it } from "vitest";
import type { Message } from "@chat/shared";
import { messageReceiptLabel, messageReceiptState } from "./MessageReadReceiptPopover";

const message = (readCount: number, recipientCount: number): Message => ({
  schemaVersion: 1,
  id: 10,
  clientId: "receipt-test",
  conversationId: 2,
  senderId: 1,
  senderName: "发送者",
  senderAvatar: "发",
  kind: "user",
  parts: [{ type: "text", text: "消息" }],
  summary: "消息",
  version: 1,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
  deletedAt: null,
  readCount,
  recipientCount,
});

describe("messageReceiptLabel", () => {
  it("单聊显示已读或未读", () => {
    expect(messageReceiptLabel(message(0, 1), "direct")).toBe("未读");
    expect(messageReceiptLabel(message(1, 1), "direct")).toBe("已读");
  });

  it("群聊显示已读人数与接收人数", () => {
    expect(messageReceiptLabel(message(1, 4), "group")).toBe("1/4 已读");
  });

  it("群聊全部已读使用简洁文案", () => {
    expect(messageReceiptLabel(message(4, 4), "group")).toBe("全部已读");
  });

  it("只有全部已读使用浅灰状态，其余使用蓝色状态", () => {
    expect(messageReceiptState(message(0, 4), "group")).toBe("pending");
    expect(messageReceiptState(message(2, 4), "group")).toBe("pending");
    expect(messageReceiptState(message(4, 4), "group")).toBe("all-read");
    expect(messageReceiptState(message(1, 1), "direct")).toBe("all-read");
  });
});
