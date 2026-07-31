// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LocalMessage, Message } from "@chat/shared";
import {
  getSelectableRange,
  isSelectableMessage,
  toggleRangeSelection,
} from "./message-selection";

function message(id: number, overrides: Partial<LocalMessage> = {}): LocalMessage {
  return {
    schemaVersion: 1,
    id,
    localId: `server:${id}`,
    serverId: id,
    clientId: `client-${id}`,
    conversationId: 9,
    senderId: 2,
    senderName: "测试成员",
    senderAvatar: "测",
    kind: "user",
    parts: [{ type: "text", text: `消息 ${id}` }],
    summary: `消息 ${id}`,
    version: 1,
    createdAt: new Date(2026, 6, 30, 10, id).toISOString(),
    updatedAt: new Date(2026, 6, 30, 10, id).toISOString(),
    deletedAt: null,
    status: "sent",
    ...overrides,
  };
}

describe("消息范围多选", () => {
  it("排除系统、发送中、失败和已撤回消息", () => {
    expect(isSelectableMessage(message(1))).toBe(true);
    expect(isSelectableMessage(message(2, { kind: "announcement" }))).toBe(true);
    expect(isSelectableMessage(message(3, { kind: "system" }))).toBe(false);
    expect(isSelectableMessage(message(-4, { status: "sending" }))).toBe(false);
    expect(isSelectableMessage(message(-5, { status: "failed" }))).toBe(false);
    expect(isSelectableMessage(message(6, { deletedAt: "2026-07-30T10:00:00.000Z" })))
      .toBe(false);
  });

  it("从锚点向下按顺序选择并限制为 30 条", () => {
    const messages: Message[] = [
      message(1),
      message(2, { kind: "system" }),
      ...Array.from({ length: 35 }, (_, index) => message(index + 3)),
    ];
    const range = getSelectableRange(messages, 2);
    expect(range.messages).toHaveLength(30);
    expect(range.messages[0].id).toBe(3);
    expect(range.messages.at(-1)?.id).toBe(32);
    expect(range.hasMore).toBe(true);
  });

  it("支持补齐、整段取消，并保留分界线上方的手动选择", () => {
    const rangeIds = [10, 11, 12];
    const completed = toggleRangeSelection(new Set([3, 10]), rangeIds);
    expect([...completed.selected]).toEqual([3, 10, 11, 12]);
    expect(completed.cleared).toBe(false);

    const cleared = toggleRangeSelection(completed.selected, rangeIds);
    expect([...cleared.selected]).toEqual([3]);
    expect(cleared.cleared).toBe(true);
  });

  it("手动选择已占用名额时不会超过 30 条", () => {
    const current = new Set(Array.from({ length: 29 }, (_, index) => index + 100));
    const result = toggleRangeSelection(current, [1, 2, 3]);
    expect(result.selected.size).toBe(30);
    expect(result.selected.has(1)).toBe(true);
    expect(result.selected.has(2)).toBe(false);
    expect(result.truncated).toBe(true);
  });
});
