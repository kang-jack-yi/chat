import { describe, expect, it } from "vitest";
import type { Attachment, Message, MessagePart } from "@chat/shared";
import {
  displayMessageText,
  groupMessageContent,
  messageContentClassNames,
} from "./MessageContent";
import { systemMessageText } from "./SystemMessage";
import { canRecallMessage } from "./MessageBubble";
import MessageView from "./MessageView";

const attachment: Attachment = {
  id: 1,
  originalName: "screen.png",
  mimeType: "image/png",
  size: 100,
  url: "chat://attachment/local/1",
};

describe("groupMessageContent", () => {
  it("defines one visual contract for every message surface", () => {
    expect(Object.keys(messageContentClassNames)).toEqual([
      "file",
      "fileIcon",
      "image",
      "imageElement",
      "text",
    ]);
    expect(messageContentClassNames.file).not.toContain("history");
    expect(messageContentClassNames.imageElement).toContain("max-h-[360px]");
  });

  it("exposes one renderer for persisted messages", () => {
    expect(MessageView).toBeTypeOf("function");
  });

  it("keeps tag-like source code as visible text", () => {
    const source = '<template #portRoute="{ row }">content</template>';
    expect(displayMessageText(source)).toBe(source);
  });

  it("preserves text and image order from the composer", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "图片前" },
      { type: "image", attachment, width: 200, height: 100 },
      { type: "text", text: "图片后" },
    ];

    expect(groupMessageContent(parts).map((group) => group.type)).toEqual([
      "text",
      "images",
      "text",
    ]);
  });

  it("groups consecutive images without moving surrounding text", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "开始" },
      { type: "image", attachment, width: 200, height: 100 },
      {
        type: "image",
        attachment: { ...attachment, id: 2 },
        width: 120,
        height: 120,
      },
      { type: "mention", userId: 2, label: "李sir" },
    ];

    const groups = groupMessageContent(parts);
    expect(groups.map((group) => group.type)).toEqual(["text", "images", "text"]);
    expect(groups[1]?.parts).toHaveLength(2);
  });

  it("renders @所有人 in the same ordered text group", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "请" },
      { type: "mention_all", label: "所有人" },
      { type: "text", text: "查看公告" },
    ];

    const groups = groupMessageContent(parts);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.type).toBe("text");
    expect(groups[0]?.parts.map((part) => part.type)).toEqual([
      "text",
      "mention_all",
      "text",
    ]);
  });

  it("formats structured system messages with current-user wording", () => {
    expect(systemMessageText({
      type: "members_invited",
      actor: { userId: 1, name: "林远" },
      members: [
        { userId: 2, name: "陈默" },
        { userId: 3, name: "周琦" },
      ],
    }, 2)).toBe("林远邀请你、周琦加入群聊");

    expect(systemMessageText({
      type: "message_recalled",
      actor: { userId: 2, name: "陈默" },
      targetMessageId: 10,
    }, 2)).toBe("你撤回了一条消息");

    expect(systemMessageText({
      type: "group_announcement_updated",
      actor: { userId: 1, name: "林远" },
    }, 2)).toBe("林远更新了群公告");

    expect(systemMessageText({
      type: "owner_transferred",
      actor: { userId: 1, name: "林远" },
      newOwner: { userId: 2, name: "陈默" },
    }, 2)).toBe("林远将群主转让给你");
  });

  it("only exposes recall for the sender within two minutes", () => {
    const now = Date.parse("2026-07-30T10:02:00.000Z");
    const recent: Message = {
      schemaVersion: 1,
      id: 10,
      clientId: "message-10",
      conversationId: 1,
      senderId: 2,
      senderName: "陈默",
      senderAvatar: "陈",
      kind: "user",
      parts: [{ type: "text", text: "测试" }],
      summary: "测试",
      version: 1,
      createdAt: "2026-07-30T10:00:01.000Z",
      updatedAt: "2026-07-30T10:00:01.000Z",
      deletedAt: null,
    };
    expect(canRecallMessage(recent, true, now)).toBe(true);
    expect(canRecallMessage(recent, false, now)).toBe(false);
    expect(canRecallMessage({
      ...recent,
      kind: "announcement",
    }, true, now)).toBe(false);
    expect(canRecallMessage({
      ...recent,
      createdAt: "2026-07-30T09:59:59.000Z",
    }, true, now)).toBe(false);
  });
});
