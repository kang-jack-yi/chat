// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { LocalMessage, SendMessagePayload } from "@chat/shared";
import { databaseWorkerTestApi as localDb } from "./worker";

const temporaryDirectories: string[] = [];

function createDatabasePath(name: string) {
  const directory = mkdtempSync(join(tmpdir(), `enterprise-chat-${name}-`));
  temporaryDirectories.push(directory);
  return join(directory, "chat.db");
}

function message(
  text = "项目进度已经同步",
  overrides: Partial<LocalMessage> = {},
): LocalMessage {
  return {
    schemaVersion: 1,
    id: 101,
    localId: "server:101",
    serverId: 101,
    clientId: "client-101",
    conversationId: 9,
    senderId: 2,
    senderName: "张工程师",
    senderAvatar: "张",
    kind: "user",
    parts: [{ type: "text", text }],
    summary: text,
    version: 1,
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:00:00.000Z",
    deletedAt: null,
    status: "sent",
    ...overrides,
  };
}

function command(clientId: string, text: string): SendMessagePayload {
  return {
    conversationId: 9,
    clientId,
    schemaVersion: 1,
    parts: [{ type: "text", text }],
  };
}

afterEach(() => {
  localDb.close();
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("Electron 本地 SQLite", () => {
  it("启用 WAL、外键和 busy timeout，并支持中文全文搜索", () => {
    const filePath = createDatabasePath("fts");
    localDb.open({ filePath, meta: { serverId: "server-a", companyId: 1, userId: 2 } });
    expect(localDb.diagnostics()).toEqual({
      journalMode: "wal",
      foreignKeys: 1,
      synchronous: 1,
      busyTimeout: 5000,
    });

    localDb.applyBootstrap({
      cursor: 8,
      users: [],
      departments: [],
      conversations: [{ id: 9, name: "研发群", lastMessage: "", lastMessageAt: null }],
      messages: [message()],
    });

    const results = localDb.searchMessages({ query: "项目进度" });
    expect(results).toHaveLength(1);
    expect(results[0].message.clientId).toBe("client-101");
    expect(localDb.getSyncState("cursor")).toBe("8");
  });

  it("普通列表过滤隐藏会话，但全局搜索仍能找到其 Mention 消息", () => {
    const filePath = createDatabasePath("hidden-search");
    localDb.open({ filePath, meta: { serverId: "server-a", companyId: 1, userId: 2 } });
    localDb.applyBootstrap({
      cursor: 8,
      users: [],
      departments: [],
      conversations: [
        { id: 9, name: "隐藏研发群", lastMessage: "@所有人 发布计划", lastMessageAt: "2026-07-28T10:00:00.000Z", hidden: true },
        { id: 10, name: "公开项目群", lastMessage: "", lastMessageAt: null, hidden: false },
      ],
      messages: [message("@所有人 发布计划", {
        parts: [
          { type: "mention_all", label: "所有人" },
          { type: "text", text: " 发布计划" },
        ],
      })],
    });

    expect(localDb.listConversations().map((item: any) => item.id)).toEqual([10]);
    const result = localDb.searchWorkspace({ keyword: "所有人", limit: 20 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].conversation.id).toBe(9);
    expect(result.messages[0].message.parts[0].type).toBe("mention_all");
  });

  it("离线发件箱跨重启保留，服务端确认后按 clientId 去重", () => {
    const filePath = createDatabasePath("outbox");
    const meta = { serverId: "server-a", companyId: 1, userId: 2 };
    const pending = message("离线消息", {
      id: -1,
      localId: "local:offline-1",
      serverId: null,
      clientId: "offline-1",
      status: "queued",
    });
    localDb.open({ filePath, meta });
    localDb.enqueueMessage({
      message: pending,
      command: command("offline-1", "离线消息"),
    });
    expect(localDb.getOutbox()).toHaveLength(1);
    expect(localDb.hasPendingConversation(9)).toBe(true);
    localDb.close();

    localDb.open({ filePath, meta });
    expect(localDb.getOutbox()[0].payload.parts[0].text).toBe("离线消息");
    localDb.markMessage({
      clientId: "offline-1",
      status: "sent",
      message: message("离线消息", { id: 202, clientId: "offline-1" }),
    });
    expect(localDb.getOutbox()).toHaveLength(0);
    expect(localDb.hasPendingConversation(9)).toBe(false);
    expect(localDb.getMessages({ conversationId: 9, limit: 20 }).items).toHaveLength(1);
  });

  it("preserves optimistic attachment message status when directly persisted", () => {
    const filePath = createDatabasePath("optimistic-attachment");
    localDb.open({
      filePath,
      meta: { serverId: "server-a", companyId: 1, userId: 2 },
    });
    localDb.upsertMessages([
      message("[图片]", {
        id: -1,
        localId: "local:image-1",
        serverId: null,
        clientId: "image-1",
        status: "uploading",
      }),
    ]);

    const saved = localDb.getMessages({ conversationId: 9 }).items[0];
    expect(saved.clientId).toBe("image-1");
    expect(saved.status).toBe("uploading");
  });

  it("preserves read counters when a later sync payload omits them", () => {
    const filePath = createDatabasePath("read-counters");
    localDb.open({
      filePath,
      meta: { serverId: "server-a", companyId: 1, userId: 2 },
    });
    const confirmed = message("已发送", {
      id: 301,
      clientId: "read-counter-1",
      readCount: 0,
      recipientCount: 2,
    });
    localDb.upsertMessages([confirmed]);
    const { readCount: _readCount, recipientCount: _recipientCount, ...syncPayload } = confirmed;
    localDb.upsertMessages([syncPayload]);

    const saved = localDb.getMessages({ conversationId: 9 }).items[0];
    expect(saved.readCount).toBe(0);
    expect(saved.recipientCount).toBe(2);
  });

  it("取消排队消息时同时移除 outbox 和本地 optimistic message", () => {
    const filePath = createDatabasePath("cancel");
    localDb.open({
      filePath,
      meta: { serverId: "server-a", companyId: 1, userId: 2 },
    });
    localDb.enqueueMessage({
      message: message("待取消消息", {
        id: -1,
        localId: "local:cancel-1",
        serverId: null,
        clientId: "cancel-1",
        status: "queued",
      }),
      command: command("cancel-1", "待取消消息"),
    });

    localDb.cancelQueuedMessage("cancel-1");

    expect(localDb.getOutbox()).toHaveLength(0);
    expect(localDb.getMessages({ conversationId: 9 }).items).toHaveLength(0);
  });

  it("按数据库文件隔离服务器，并忽略低版本乱序事件", () => {
    const firstPath = createDatabasePath("server-a");
    const secondPath = createDatabasePath("server-b");
    localDb.open({ filePath: firstPath, meta: { serverId: "server-a", companyId: 1, userId: 2 } });
    localDb.applyBootstrap({
      cursor: 10,
      users: [],
      departments: [],
      conversations: [{ id: 9, name: "研发群", lastMessage: "", lastMessageAt: null }],
      messages: [message("版本一")],
    });
    localDb.applyEvents([
      {
        seq: 11,
        type: "message.upsert",
        entityId: "101",
        version: 3,
        occurredAt: "2026-07-28T10:01:00.000Z",
        payload: message("版本三", { version: 3 }),
      },
      {
        seq: 12,
        type: "message.upsert",
        entityId: "101",
        version: 2,
        occurredAt: "2026-07-28T10:02:00.000Z",
        payload: message("过期版本", { version: 2 }),
      },
    ]);
    expect(localDb.getMessages({ conversationId: 9 }).items[0].summary).toBe("版本三");

    localDb.open({ filePath: secondPath, meta: { serverId: "server-b", companyId: 1, userId: 2 } });
    expect(localDb.getMessages({ conversationId: 9 }).items).toHaveLength(0);
    localDb.open({ filePath: firstPath, meta: { serverId: "server-a", companyId: 1, userId: 2 } });
    expect(localDb.getMessages({ conversationId: 9 }).items[0].summary).toBe("版本三");
  });

  it("按类型、发送人和日期筛选历史消息，并使用不透明游标分页", () => {
    const filePath = createDatabasePath("history");
    localDb.open({ filePath, meta: { serverId: "server-a", companyId: 1, userId: 2 } });
    const attachment = {
      id: 7,
      originalName: "方案.pdf",
      mimeType: "application/pdf",
      size: 1024,
      url: "/uploads/7",
    };
    localDb.applyBootstrap({
      cursor: 9,
      users: [],
      departments: [],
      conversations: [{ id: 9, name: "研发群", lastMessage: "", lastMessageAt: null }],
      messages: [
        message("第一条", { id: 101, clientId: "client-101" }),
        message("第二条", {
          id: 102,
          clientId: "client-102",
          senderId: 3,
          senderName: "李产品",
          createdAt: "2026-07-29T10:00:00.000Z",
        }),
        message("[文件] 方案.pdf", {
          id: 103,
          clientId: "client-103",
          createdAt: "2026-07-30T10:00:00.000Z",
          parts: [{ type: "file", attachment }],
        }),
      ],
    });

    const firstPage = localDb.queryMessageHistory({
      conversationId: 9,
      category: "all",
      limit: 2,
    });
    expect(firstPage.items.map((item: any) => item.message.id)).toEqual([103, 102]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(localDb.queryMessageHistory({
      conversationId: 9,
      category: "all",
      cursor: firstPage.nextCursor || undefined,
      limit: 2,
    }).items[0].message.id).toBe(101);
    expect(localDb.queryMessageHistory({
      conversationId: 9,
      category: "file",
      senderId: 2,
      startAt: "2026-07-30T00:00:00.000Z",
      endAt: "2026-07-31T00:00:00.000Z",
      limit: 50,
    }).items.map((item: any) => item.message.id)).toEqual([103]);
  });

  it("读取目标消息前后各自的上下文", () => {
    const filePath = createDatabasePath("context");
    localDb.open({ filePath, meta: { serverId: "server-a", companyId: 1, userId: 2 } });
    localDb.applyBootstrap({
      cursor: 9,
      users: [],
      departments: [],
      conversations: [{ id: 9, name: "研发群", lastMessage: "", lastMessageAt: null }],
      messages: [101, 102, 103].map((id) => message(`消息 ${id}`, {
        id,
        clientId: `client-${id}`,
        createdAt: `2026-07-28T10:0${id - 101}:00.000Z`,
      })),
    });

    const context = localDb.getMessageContext({ conversationId: 9, messageId: 102 });
    expect(context.targetId).toBe(102);
    expect(context.items.map((item: any) => item.id)).toEqual([101, 102, 103]);
  });

  it("附录选择只读取最近 30 条已发送普通消息", () => {
    const filePath = createDatabasePath("invite-history");
    localDb.open({
      filePath,
      meta: { serverId: "server-a", companyId: 1, userId: 2 },
    });
    const sentMessages = Array.from({ length: 34 }, (_, index) => message(`普通消息 ${index + 1}`, {
      id: 101 + index,
      clientId: `invite-${index + 1}`,
      createdAt: `2026-07-30T10:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    localDb.applyBootstrap({
      cursor: 40,
      users: [],
      departments: [],
      conversations: [{ id: 9, name: "研发群", lastMessage: "", lastMessageAt: null }],
      messages: [
        ...sentMessages,
        message("系统提示", {
          id: 200,
          clientId: "invite-system",
          kind: "system",
          parts: [{
            type: "system_event",
            event: {
              type: "members_invited",
              actor: { userId: 2, name: "张工程师" },
              members: [{ userId: 3, name: "李产品" }],
            },
          }],
        }),
      ],
    });
    localDb.enqueueMessage({
      message: message("发送中", {
        id: -1,
        serverId: null,
        localId: "local:invite-pending",
        clientId: "invite-pending",
        status: "queued",
      }),
      command: command("invite-pending", "发送中"),
    });

    const recent = localDb.getRecentUserMessages({ conversationId: 9, limit: 30 });

    expect(recent).toHaveLength(30);
    expect(recent.map((item: any) => item.id)).toEqual(
      sentMessages.slice(-30).map((item) => item.id),
    );
    expect(recent.every((item: any) => item.kind === "user" && item.status === "sent"))
      .toBe(true);
  });

  it("按会话顺序分页读取图片图库，并排除文件、系统消息和撤回图片", () => {
    const filePath = createDatabasePath("image-gallery");
    localDb.open({
      filePath,
      meta: { serverId: "server-a", companyId: 1, userId: 2 },
    });
    const imagePart = (id: number, name: string) => ({
      type: "image" as const,
      attachment: {
        id,
        originalName: name,
        mimeType: "image/png",
        size: 1024,
        url: `/api/files/${id}`,
      },
      width: 800,
      height: 600,
    });
    localDb.applyBootstrap({
      cursor: 40,
      users: [],
      departments: [],
      conversations: [{ id: 9, name: "研发群", lastMessage: "", lastMessageAt: null }],
      messages: [
        message("[图片]", {
          id: 101,
          clientId: "gallery-101",
          parts: [imagePart(11, "第一张.png"), imagePart(12, "第二张.png")],
        }),
        message("[文件]", {
          id: 102,
          clientId: "gallery-102",
          createdAt: "2026-07-28T10:01:00.000Z",
          parts: [{
            type: "file",
            attachment: {
              id: 20,
              originalName: "资料.pdf",
              mimeType: "application/pdf",
              size: 1024,
              url: "/api/files/20",
            },
          }],
        }),
        message("[图片]", {
          id: 103,
          clientId: "gallery-103",
          createdAt: "2026-07-28T10:02:00.000Z",
          parts: [imagePart(13, "第三张.png")],
        }),
        message("[图片]", {
          id: 104,
          clientId: "gallery-deleted",
          createdAt: "2026-07-28T10:03:00.000Z",
          deletedAt: "2026-07-28T10:04:00.000Z",
          parts: [imagePart(14, "已撤回.png")],
        }),
      ],
    });

    const initial = localDb.queryImageGallery({
      conversationId: 9,
      attachmentId: 12,
      direction: "initial",
      limit: 1,
    });
    expect(initial.items.map((item: any) => item.attachmentId)).toEqual([12]);
    expect(initial.previousCursor).toEqual(expect.any(String));
    expect(initial.nextCursor).toEqual(expect.any(String));
    expect(initial.items.every((item: any) => item.mimeType === "image/png")).toBe(true);

    const previous = localDb.queryImageGallery({
      conversationId: 9,
      direction: "previous",
      cursor: initial.previousCursor ?? undefined,
      limit: 2,
    });
    expect(previous.items.map((item: any) => item.attachmentId)).toEqual([11]);
  });

  it("撤回事件移除正文索引和附件缓存，并可搜索系统消息", () => {
    const filePath = createDatabasePath("recall");
    const cacheDirectory = join(dirname(filePath), "cache");
    mkdirSync(cacheDirectory, { recursive: true });
    localDb.open({
      filePath,
      cacheDirectory,
      meta: { serverId: "server-a", companyId: 1, userId: 2 },
    });
    const attachment = {
      id: 88,
      originalName: "待撤回方案.pdf",
      mimeType: "application/pdf",
      size: 1024,
      url: "/api/files/88",
    };
    localDb.applyBootstrap({
      cursor: 20,
      users: [],
      departments: [],
      conversations: [{ id: 9, name: "研发群", lastMessage: "", lastMessageAt: null }],
      messages: [message("[文件] 待撤回方案.pdf", {
        parts: [{ type: "file", attachment }],
      })],
    });
    const cachedFile = join(cacheDirectory, "88.bin");
    writeFileSync(cachedFile, "cached");
    localDb.setAttachmentCachePath({
      attachmentId: 88,
      localCachePath: cachedFile,
    });

    localDb.applyEvents([
      {
        seq: 21,
        type: "message.delete",
        entityId: "101",
        version: 2,
        occurredAt: "2026-07-28T10:01:00.000Z",
        payload: { id: 101, deletedAt: "2026-07-28T10:01:00.000Z" },
      },
      {
        seq: 22,
        type: "message.upsert",
        entityId: "102",
        version: 1,
        occurredAt: "2026-07-28T10:01:00.000Z",
        payload: message("张工程师撤回了一条消息", {
          id: 102,
          clientId: "system-recall-102",
          kind: "system",
          parts: [{
            type: "system_event",
            event: {
              type: "message_recalled",
              actor: { userId: 2, name: "张工程师" },
              targetMessageId: 101,
            },
          }],
          summary: "张工程师撤回了一条消息",
        }),
      },
    ]);

    expect(existsSync(cachedFile)).toBe(false);
    expect(localDb.searchMessages({ query: "待撤回方案" })).toHaveLength(0);
    const systemResults = localDb.searchWorkspace({ keyword: "撤回", limit: 20 });
    expect(systemResults.messages).toHaveLength(1);
    expect(systemResults.messages[0].message.kind).toBe("system");
    expect(localDb.getMessages({ conversationId: 9 }).items.map((item: any) => item.id))
      .toEqual([102]);
  });

  it("索引转发快照内容，并应用账号级删除事件", () => {
    const filePath = createDatabasePath("forward-user-delete");
    localDb.open({ filePath, meta: { serverId: "server-a", companyId: 1, userId: 2 } });
    const forwarded = message("转发的实施方案", {
      id: 120,
      clientId: "forwarded-120",
      parts: [{
        type: "forwarded_message",
        snapshot: {
          originalMessageId: 88,
          senderId: 3,
          senderName: "李工程师",
          senderAvatar: "李",
          createdAt: "2026-07-28T09:30:00.000Z",
          summary: "转发的实施方案",
          parts: [
            { type: "text", text: "请检查离线同步" },
            {
              type: "file",
              attachment: {
                id: 98,
                originalName: "转发实施方案.pdf",
                mimeType: "application/pdf",
                size: 2048,
                url: "/api/files/98",
              },
            },
          ],
        },
      }],
    });
    localDb.applyBootstrap({
      cursor: 30,
      users: [],
      departments: [],
      conversations: [{ id: 9, name: "研发群", lastMessage: "", lastMessageAt: null }],
      messages: [forwarded],
    });

    expect(localDb.searchMessages({ query: "离线同步" })).toHaveLength(1);
    expect(localDb.searchMessages({ query: "转发实施方案.pdf" })).toHaveLength(1);

    localDb.applyEvents([{
      seq: 31,
      type: "message.user-delete",
      entityId: "9:120",
      conversationId: 9,
      version: 1,
      occurredAt: "2026-07-28T10:10:00.000Z",
      payload: {
        conversationId: 9,
        messageIds: [120],
        deletedAt: "2026-07-28T10:10:00.000Z",
      },
    }]);

    expect(localDb.getMessages({ conversationId: 9 }).items).toHaveLength(0);
    expect(localDb.searchMessages({ query: "离线同步" })).toHaveLength(0);
    expect(localDb.searchMessages({ query: "转发实施方案.pdf" })).toHaveLength(0);
  });
});
