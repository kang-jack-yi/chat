import { describe, expect, it } from "vitest";
import type { Message } from "@chat/shared";
import { continuesMessageGroup } from "./message-grouping";

/** 构造完整消息，避免用类型断言掩盖真实消息域的身份字段。 */
function message(overrides: Partial<Message> = {}): Message {
  return {
    schemaVersion: 1,
    id: 1,
    clientId: "message-1",
    conversationId: 1,
    senderId: 2,
    senderType: "user",
    senderName: "同事",
    senderAvatar: "同",
    kind: "user",
    parts: [],
    summary: "消息",
    version: 1,
    createdAt: "2026-10-23T08:00:00.000Z",
    updatedAt: "2026-10-23T08:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("continuesMessageGroup", () => {
  it("starts a group when there is no previous message", () => {
    expect(continuesMessageGroup(undefined, message())).toBe(false);
  });

  it("continues messages from the same user", () => {
    expect(continuesMessageGroup(message(), message({ id: 2 }))).toBe(true);
  });

  it("separates different users", () => {
    expect(continuesMessageGroup(message(), message({ senderId: 3 }))).toBe(
      false,
    );
  });

  it("separates sender types even when their numeric sender IDs match", () => {
    expect(
      continuesMessageGroup(
        message({ senderId: 0 }),
        message({ senderId: 0, senderType: "bot", senderBotId: 11 }),
      ),
    ).toBe(false);
  });

  it("continues the same bot even when its display name changes", () => {
    expect(
      continuesMessageGroup(
        message({ senderId: 0, senderType: "bot", senderBotId: 11 }),
        message({
          senderId: 0,
          senderType: "bot",
          senderBotId: 11,
          senderName: "新名称",
        }),
      ),
    ).toBe(true);
  });

  it("separates different bots sharing senderId zero", () => {
    expect(
      continuesMessageGroup(
        message({ senderId: 0, senderType: "bot", senderBotId: 11 }),
        message({ senderId: 0, senderType: "bot", senderBotId: 22 }),
      ),
    ).toBe(false);
  });

  it.each([undefined, null])(
    "does not group bots without a known bot ID (%s)",
    (senderBotId) => {
      const bot = message({ senderId: 0, senderType: "bot", senderBotId });
      expect(continuesMessageGroup(bot, bot)).toBe(false);
    },
  );

  it.each(["system", "announcement"] as const)(
    "breaks grouping on either side of a %s message",
    (kind) => {
      expect(continuesMessageGroup(message({ kind }), message())).toBe(false);
      expect(continuesMessageGroup(message(), message({ kind }))).toBe(false);
    },
  );

  it.each([
    [-1, false],
    [0, true],
    [299999, true],
    [300000, false],
    [300001, false],
  ])(
    "checks the inclusive zero / exclusive five-minute boundary: %i ms",
    (gap, expected) => {
      const previous = message();
      const next = message({
        createdAt: new Date(Date.parse(previous.createdAt) + gap).toISOString(),
      });
      expect(continuesMessageGroup(previous, next)).toBe(expected);
    },
  );

  it("does not group messages with an invalid timestamp", () => {
    expect(
      continuesMessageGroup(message({ createdAt: "invalid" }), message()),
    ).toBe(false);
    expect(
      continuesMessageGroup(message(), message({ createdAt: "invalid" })),
    ).toBe(false);
  });
});
