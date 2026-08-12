// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databaseWorkerTestApi as localDb } from "./worker";

let directory = "";

afterEach(() => {
  localDb.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("persists cleared unread and mention state when a conversation is opened", () => {
  directory = mkdtempSync(join(tmpdir(), "enterprise-chat-read-"));
  localDb.open({
    filePath: join(directory, "chat.db"),
    meta: { serverId: "server-a", companyId: 1, userId: 2 },
  });
  localDb.applyBootstrap({
    cursor: 1,
    users: [],
    departments: [],
    conversations: [{
      id: 9,
      name: "read-test",
      lastMessage: "hello",
      lastMessageAt: "2026-08-12T03:00:00.000Z",
      unreadCount: 4,
      mentioned: true,
      mentionMessageId: 101,
      mentionType: "member",
    }],
    messages: [],
  });

  expect(localDb.markConversationRead(9)).toBe(true);
  expect(localDb.listConversations()[0]).toMatchObject({
    unreadCount: 0,
    mentioned: false,
    mentionMessageId: null,
    mentionType: null,
  });
});
