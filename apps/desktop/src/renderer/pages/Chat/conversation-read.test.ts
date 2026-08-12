import { describe, expect, it } from "vitest";
import type { Conversation } from "@chat/shared";
import { clearConversationUnread } from "./conversation-read";

function conversation(input: Partial<Conversation> = {}): Conversation {
  return {
    id: 1,
    type: "direct",
    createdBy: 1,
    name: "测试会话",
    avatar: "测",
    lastMessage: "消息",
    lastMessageId: 10,
    lastMessageAt: "2026-08-12T03:00:00.000Z",
    unreadCount: 3,
    memberCount: 2,
    pinned: false,
    muted: false,
    hidden: false,
    mentioned: true,
    mentionMessageId: 9,
    mentionType: "member",
    members: [],
    ...input,
  };
}

describe("clearConversationUnread", () => {
  it("clears unread and mention state only for the opened conversation", () => {
    const other = conversation({ id: 2, unreadCount: 5 });
    const result = clearConversationUnread([conversation(), other], 1)!;

    expect(result[0]).toMatchObject({
      unreadCount: 0,
      mentioned: false,
      mentionMessageId: null,
      mentionType: null,
    });
    expect(result[1]).toBe(other);
  });

  it("keeps the cache shape when conversations have not loaded", () => {
    expect(clearConversationUnread(undefined, 1)).toBeUndefined();
  });
});
