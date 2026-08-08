import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { initializeSchema } from "./database/schema";

type RequestMessage = { id: string; method: string; args?: any };
type ResponseMessage = { id: string; result?: unknown; error?: string };

let database: Database.Database | null = null;
let currentPath = "";
let currentCacheDirectory = "";
const parentPort = (process as NodeJS.Process & {
  parentPort?: {
    on(event: "message", listener: (event: { data: RequestMessage }) => void): void;
    postMessage(message: ResponseMessage): void;
  };
}).parentPort;

function db() {
  if (!database) throw new Error("本地数据库尚未打开");
  return database;
}

function open(input: {
  filePath: string;
  cacheDirectory?: string;
  meta: Record<string, string | number>;
}) {
  if (database && currentPath === input.filePath) return { filePath: currentPath };
  close();
  fs.mkdirSync(path.dirname(input.filePath), { recursive: true });
  database = new Database(input.filePath);
  currentPath = input.filePath;
  currentCacheDirectory = input.cacheDirectory ? path.resolve(input.cacheDirectory) : "";
  initializeSchema(database);
  const statement = database.prepare(
    "INSERT INTO local_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  const transaction = database.transaction(() => {
    for (const [key, value] of Object.entries(input.meta)) statement.run(key, String(value));
  });
  transaction();
  return { filePath: currentPath };
}

function close() {
  if (database) {
    database.close();
    database = null;
  }
  currentPath = "";
  currentCacheDirectory = "";
  return true;
}

function messageParts(message: any) {
  return Array.isArray(message?.parts) ? message.parts : [];
}

function flattenedMessageParts(message: any) {
  const result: any[] = [];
  const visit = (parts: any[]) => {
    for (const part of parts || []) {
      if (part?.type === "forwarded_message") {
        visit(part.snapshot?.parts || []);
      } else if (part?.type === "chat_record") {
        for (const item of part.items || []) visit(item?.parts || []);
      } else {
        result.push(part);
      }
    }
  };
  visit(messageParts(message));
  return result;
}

function systemEventSearchText(event: any) {
  if (!event || typeof event !== "object") return "";
  const values = [
    event.actor?.name,
    event.member?.name,
    event.oldName,
    event.newName,
    ...(Array.isArray(event.members) ? event.members.map((member: any) => member?.name) : []),
    ...(Array.isArray(event.invitedMembers)
      ? event.invitedMembers.map((member: any) => member?.name)
      : []),
  ];
  return values.filter(Boolean).join(" ");
}

function messageSearchText(message: any) {
  const parts = flattenedMessageParts(message).map((part: any) => {
    if (part.type === "text") return String(part.text || "");
    if (part.type === "mention") return String(part.label || "");
    if (part.type === "mention_all") return "所有人";
    if (part.type === "quote") return String(part.summary || "");
    if (part.type === "quote_snapshot") {
      return `${String(part.senderName || "")} ${String(part.summary || "")}`;
    }
    if (part.type === "file") return String(part.attachment?.originalName || "");
    if (part.type === "system_event") return systemEventSearchText(part.event);
    return "";
  });
  if (message?.kind === "system") parts.push(String(message.summary || ""));
  return parts.join(" ").trim();
}

function messageFileNames(message: any) {
  return flattenedMessageParts(message)
    .filter((part: any) => part.type === "file" || part.type === "image")
    .map((part: any) => String(part.attachment?.originalName || ""))
    .filter(Boolean)
    .join(" ");
}

function upsertMessage(message: any, status = "sent", version = 1) {
  const connection = db();
  const existingRow = connection.prepare(
    "SELECT payload FROM messages WHERE client_id=?",
  ).get(message.clientId) as { payload?: string } | undefined;
  let existingMessage: any;
  try {
    existingMessage = existingRow?.payload ? JSON.parse(existingRow.payload) : undefined;
  } catch {
    existingMessage = undefined;
  }
  const storedMessage = {
    ...message,
    ...(message.readCount == null && existingMessage?.readCount != null
      ? { readCount: existingMessage.readCount }
      : {}),
    ...(message.recipientCount == null && existingMessage?.recipientCount != null
      ? { recipientCount: existingMessage.recipientCount }
      : {}),
  };
  const serverId = Number(message.id) > 0 ? Number(message.id) : null;
  const localId = serverId ? `server:${serverId}` : `local:${message.clientId}`;
  const now = new Date().toISOString();
  const searchText = messageSearchText(message);
  const fileName = messageFileNames(message);
  connection.prepare(`
    INSERT INTO messages(
      local_id, server_id, client_id, conversation_id, sender_id, sender_name,
      kind, summary, search_text, file_name, status, version, created_at, updated_at, deleted_at, payload
    ) VALUES(
      @localId, @serverId, @clientId, @conversationId, @senderId, @senderName,
      @kind, @summary, @searchText, @fileName, @status, @version, @createdAt, @updatedAt, @deletedAt, @payload
    )
    ON CONFLICT(client_id) DO UPDATE SET
      local_id=excluded.local_id,
      server_id=COALESCE(excluded.server_id, messages.server_id),
      sender_name=excluded.sender_name,
      kind=excluded.kind,
      summary=excluded.summary,
      search_text=excluded.search_text,
      file_name=excluded.file_name,
      status=excluded.status,
      version=MAX(messages.version, excluded.version),
      created_at=excluded.created_at,
      updated_at=excluded.updated_at,
      deleted_at=excluded.deleted_at,
      payload=excluded.payload
    WHERE excluded.version >= messages.version
  `).run({
    localId,
    serverId,
    clientId: message.clientId,
    conversationId: Number(message.conversationId),
    senderId: Number(message.senderId),
    senderName: String(message.senderName || ""),
    kind: message.kind || "user",
    summary: String(message.summary || ""),
    searchText,
    fileName,
    status,
    version,
    createdAt: message.createdAt || now,
    updatedAt: now,
    deletedAt: message.deletedAt || null,
    payload: JSON.stringify({ ...storedMessage, id: serverId ?? message.id, status }),
  });
  const row = connection.prepare("SELECT row_id FROM messages WHERE client_id = ?").get(message.clientId) as any;
  connection.prepare("DELETE FROM message_fts WHERE rowid = ?").run(row.row_id);
  if (!message.deletedAt) {
    connection.prepare(
      "INSERT INTO message_fts(rowid, content, sender_name, file_name) VALUES(?, ?, ?, ?)",
    ).run(row.row_id, searchText, message.senderName || "", fileName);
  }
  for (const part of flattenedMessageParts(storedMessage)) {
    if (!part.attachment?.id) continue;
    connection.prepare(`
      INSERT INTO attachments(id, message_server_id, payload, last_accessed_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        message_server_id=excluded.message_server_id,
        payload=excluded.payload,
        last_accessed_at=excluded.last_accessed_at
    `).run(
      Number(part.attachment.id),
      serverId,
      JSON.stringify(part.attachment),
      now,
    );
  }
  const conversationRow = connection.prepare("SELECT payload, last_message_at FROM conversations WHERE id=?")
    .get(Number(message.conversationId)) as any;
  if (conversationRow && (!conversationRow.last_message_at || message.createdAt >= conversationRow.last_message_at)) {
    const conversation = JSON.parse(conversationRow.payload);
    const preview = String(message.summary || "[消息]").slice(0, 100);
    conversation.lastMessage = preview;
    conversation.lastMessageAt = message.createdAt;
    connection.prepare(`
      UPDATE conversations SET last_message=?, last_message_at=?, payload=?, updated_at=? WHERE id=?
    `).run(preview, message.createdAt, JSON.stringify(conversation), now, Number(message.conversationId));
  }
}

function applyBootstrap(input: any) {
  const connection = db();
  const now = new Date().toISOString();
  const upsertUser = connection.prepare(
    "INSERT INTO users(id, payload, updated_at) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
  );
  const upsertDepartment = connection.prepare(
    "INSERT INTO departments(id, payload, updated_at) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
  );
  const upsertConversation = connection.prepare(`
    INSERT INTO conversations(id, name, last_message, last_message_at, pinned, hidden, payload, updated_at)
    VALUES(@id, @name, @lastMessage, @lastMessageAt, @pinned, @hidden, @payload, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, last_message=excluded.last_message,
      last_message_at=excluded.last_message_at, pinned=excluded.pinned, hidden=excluded.hidden,
      payload=excluded.payload, updated_at=excluded.updated_at
  `);
  const transaction = connection.transaction(() => {
    connection.prepare("DELETE FROM conversations").run();
    connection.prepare("DELETE FROM conversation_members").run();
    connection.prepare("DELETE FROM users").run();
    connection.prepare("DELETE FROM departments").run();
    for (const user of input.users || []) upsertUser.run(user.id, JSON.stringify(user), now);
    for (const department of input.departments || []) {
      upsertDepartment.run(department.id, JSON.stringify(department), now);
    }
    for (const conversation of input.conversations || []) {
      upsertConversation.run({
        id: conversation.id,
        name: conversation.name || "",
        lastMessage: conversation.lastMessage || "",
        lastMessageAt: conversation.lastMessageAt || null,
        pinned: conversation.pinned ? 1 : 0,
        hidden: conversation.hidden ? 1 : 0,
        payload: JSON.stringify(conversation),
        updatedAt: now,
      });
      const memberStatement = connection.prepare(`
        INSERT INTO conversation_members(conversation_id, user_id, payload, updated_at)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(conversation_id, user_id) DO UPDATE SET
          payload=excluded.payload, updated_at=excluded.updated_at
      `);
      for (const member of conversation.members || []) {
        memberStatement.run(conversation.id, member.id, JSON.stringify(member), now);
      }
    }
    for (const message of input.messages || []) upsertMessage(message);
    setSyncStateUnsafe("cursor", String(input.cursor || 0), now);
    setSyncStateUnsafe("historyComplete", "0", now);
  });
  transaction();
  return true;
}

function removeRecalledAttachmentCache(connection: Database.Database, message: any) {
  const attachmentIds = flattenedMessageParts(message)
    .map((part: any) => Number(part.attachment?.id))
    .filter((id: number) => Number.isSafeInteger(id) && id > 0);
  for (const attachmentId of attachmentIds) {
    const attachment = connection.prepare(
      "SELECT local_cache_path FROM attachments WHERE id=?",
    ).get(attachmentId) as { local_cache_path?: string } | undefined;
    if (attachment?.local_cache_path && currentCacheDirectory) {
      const target = path.resolve(attachment.local_cache_path);
      const expectedName = `${attachmentId}.bin`;
      if (
        path.basename(target) === expectedName
        && target.startsWith(`${currentCacheDirectory}${path.sep}`)
      ) {
        fs.rmSync(target, { force: true });
      }
    }
    connection.prepare(
      "UPDATE attachments SET local_cache_path=NULL WHERE id=?",
    ).run(attachmentId);
  }
}

function applyEvents(events: any[]) {
  const connection = db();
  const transaction = connection.transaction(() => {
    let cursor = 0;
    for (const event of events) {
      cursor = Math.max(cursor, Number(event.seq || 0));
      if (event.type === "message.upsert") upsertMessage(event.payload, "sent", event.version);
      if (event.type === "read.updated") {
        connection.prepare(`
          INSERT INTO read_states(conversation_id, user_id, message_id, updated_at)
          VALUES(?, ?, ?, ?)
          ON CONFLICT(conversation_id, user_id) DO UPDATE SET
            message_id=MAX(read_states.message_id, excluded.message_id),
            updated_at=excluded.updated_at
        `).run(
          event.payload.conversationId,
          event.payload.userId,
          event.payload.messageId,
          event.occurredAt,
        );
      }
      if (event.type === "conversation.upsert" && Object.keys(event.payload || {}).length > 1) {
        upsertConversations([event.payload]);
      }
      if (event.type === "contact.upsert") {
        if (event.payload.deletedAt) {
          connection.prepare("DELETE FROM users WHERE id=?").run(event.payload.id);
        } else {
          connection.prepare(`
            INSERT INTO users(id, payload, updated_at) VALUES(?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
          `).run(event.payload.id, JSON.stringify(event.payload), event.occurredAt);
        }
      }
      if (event.type === "department.upsert") {
        if (event.payload.deletedAt) {
          connection.prepare("DELETE FROM departments WHERE id=?").run(event.payload.id);
        } else {
          connection.prepare(`
            INSERT INTO departments(id, payload, updated_at) VALUES(?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
          `).run(event.payload.id, JSON.stringify(event.payload), event.occurredAt);
        }
      }
      if (event.type === "message.delete") {
        const row = connection.prepare(
          "SELECT row_id, payload FROM messages WHERE server_id = ?",
        ).get(Number(event.entityId)) as any;
        if (row) {
          const message = JSON.parse(row.payload);
          const deletedAt = event.payload?.deletedAt || event.occurredAt;
          removeRecalledAttachmentCache(connection, message);
          connection.prepare(
            "UPDATE messages SET deleted_at=?, version=?, payload=? WHERE server_id=?",
          ).run(
            deletedAt,
            event.version,
            JSON.stringify({ ...message, deletedAt }),
            Number(event.entityId),
          );
          connection.prepare("DELETE FROM message_fts WHERE rowid=?").run(row.row_id);
        }
      }
      if (event.type === "message.user-delete") {
        for (const messageId of event.payload?.messageIds || []) {
          removeMessageForCurrentUser(connection, Number(messageId));
        }
      }
    }
    if (cursor) setSyncStateUnsafe("cursor", String(cursor), new Date().toISOString());
  });
  transaction();
  return true;
}

function upsertMessages(messages: any[]) {
  const transaction = db().transaction(() => {
    for (const message of messages || []) {
      const version = Number(message.version);
      upsertMessage(
        message,
        message.status || "sent",
        Number.isSafeInteger(version) && version > 0 ? version : 1,
      );
    }
  });
  transaction();
  return true;
}

function removeMessageForCurrentUser(
  connection: Database.Database,
  messageId: number,
) {
  const row = connection.prepare(
    "SELECT row_id, payload FROM messages WHERE server_id=?",
  ).get(messageId) as { row_id: number; payload: string } | undefined;
  if (!row) return;
  const message = JSON.parse(row.payload);
  const attachmentIds = flattenedMessageParts(message)
    .map((part: any) => Number(part.attachment?.id))
    .filter((id: number) => Number.isSafeInteger(id) && id > 0);
  for (const attachmentId of attachmentIds) {
    const attachment = connection.prepare(
      "SELECT local_cache_path FROM attachments WHERE id=?",
    ).get(attachmentId) as { local_cache_path?: string } | undefined;
    if (attachment?.local_cache_path && currentCacheDirectory) {
      const target = path.resolve(attachment.local_cache_path);
      if (
        path.basename(target) === `${attachmentId}.bin`
        && target.startsWith(`${currentCacheDirectory}${path.sep}`)
      ) {
        fs.rmSync(target, { force: true });
      }
    }
    connection.prepare("DELETE FROM attachments WHERE id=?").run(attachmentId);
  }
  connection.prepare("DELETE FROM message_fts WHERE rowid=?").run(row.row_id);
  connection.prepare("DELETE FROM messages WHERE row_id=?").run(row.row_id);
}

function removeMessagesForMe(input: {
  conversationId: number;
  messageIds: number[];
}) {
  const connection = db();
  const transaction = connection.transaction(() => {
    for (const messageId of input.messageIds || []) {
      const row = connection.prepare(
        "SELECT conversation_id FROM messages WHERE server_id=?",
      ).get(Number(messageId)) as { conversation_id: number } | undefined;
      if (row && Number(row.conversation_id) === Number(input.conversationId)) {
        removeMessageForCurrentUser(connection, Number(messageId));
      }
    }
  });
  transaction();
  return true;
}

function getMessage(input: { conversationId: number; messageId: number }) {
  const row = db().prepare(`
    SELECT payload, status FROM messages
    WHERE conversation_id=? AND server_id=? AND deleted_at IS NULL
  `).get(Number(input.conversationId), Number(input.messageId)) as any;
  return row ? { ...JSON.parse(row.payload), status: row.status } : null;
}

function listConversations() {
  return db().prepare(
    "SELECT payload FROM conversations WHERE hidden=0 ORDER BY pinned DESC, COALESCE(last_message_at, '') DESC, id DESC",
  ).all().map((row: any) => JSON.parse(row.payload));
}

function upsertConversations(conversations: any[]) {
  const connection = db();
  const statement = connection.prepare(`
    INSERT INTO conversations(id, name, last_message, last_message_at, pinned, hidden, payload, updated_at)
    VALUES(@id, @name, @lastMessage, @lastMessageAt, @pinned, @hidden, @payload, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, last_message=excluded.last_message,
      last_message_at=excluded.last_message_at, pinned=excluded.pinned, hidden=excluded.hidden,
      payload=excluded.payload, updated_at=excluded.updated_at
  `);
  const upsertMember = connection.prepare(`
    INSERT INTO conversation_members(conversation_id, user_id, payload, updated_at)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(conversation_id, user_id) DO UPDATE SET
      payload=excluded.payload, updated_at=excluded.updated_at
  `);
  const transaction = connection.transaction(() => {
    for (const conversation of conversations || []) {
      const now = new Date().toISOString();
      statement.run({
        id: conversation.id,
        name: conversation.name || "",
        lastMessage: conversation.lastMessage || "",
        lastMessageAt: conversation.lastMessageAt || null,
        pinned: conversation.pinned ? 1 : 0,
        hidden: conversation.hidden ? 1 : 0,
        payload: JSON.stringify(conversation),
        updatedAt: now,
      });
      connection.prepare("DELETE FROM conversation_members WHERE conversation_id=?").run(conversation.id);
      for (const member of conversation.members || []) {
        upsertMember.run(conversation.id, member.id, JSON.stringify(member), now);
      }
    }
  });
  transaction();
  return true;
}

function replaceConversations(conversations: any[]) {
  const connection = db();
  const transaction = connection.transaction(() => {
    const ids = (conversations || []).map((conversation) => Number(conversation.id));
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      connection.prepare(`DELETE FROM conversation_members WHERE conversation_id NOT IN (${placeholders})`).run(...ids);
      connection.prepare(`DELETE FROM conversations WHERE id NOT IN (${placeholders})`).run(...ids);
    } else {
      connection.prepare("DELETE FROM conversation_members").run();
      connection.prepare("DELETE FROM conversations").run();
    }
    upsertConversations(conversations);
  });
  transaction();
  return true;
}

function getMessages(input: { conversationId: number; before?: number; limit?: number }) {
  const limit = Math.min(Math.max(input.limit || 30, 1), 100);
  const rows = input.before
    ? db().prepare(`
        SELECT payload, server_id, status FROM messages
        WHERE conversation_id=? AND deleted_at IS NULL AND (server_id IS NULL OR server_id < ?)
        ORDER BY COALESCE(server_id, 9223372036854775807) DESC, row_id DESC LIMIT ?
      `).all(input.conversationId, input.before, limit)
    : db().prepare(`
        SELECT payload, server_id, status FROM messages
        WHERE conversation_id=? AND deleted_at IS NULL
        ORDER BY COALESCE(server_id, 9223372036854775807) DESC, row_id DESC LIMIT ?
      `).all(input.conversationId, limit);
  const items = rows.reverse().map((row: any) => ({ ...JSON.parse(row.payload), status: row.status }));
  const oldest = items.find((item: any) => Number(item.id) > 0);
  return { items, nextCursor: rows.length === limit ? Number(oldest?.id || 0) || null : null };
}

function getRecentUserMessages(input: { conversationId: number; limit?: number }) {
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 30);
  const rows = db().prepare(`
    SELECT payload, status FROM messages
    WHERE conversation_id=?
      AND kind='user'
      AND server_id IS NOT NULL
      AND server_id>0
      AND status='sent'
      AND deleted_at IS NULL
    ORDER BY server_id DESC, row_id DESC
    LIMIT ?
  `).all(Number(input.conversationId), limit) as any[];
  return rows.reverse().map((row) => ({
    ...JSON.parse(row.payload),
    status: row.status,
  }));
}

function clearConversationMessages(conversationId: number) {
  const connection = db();
  const transaction = connection.transaction(() => {
    const rows = connection.prepare("SELECT row_id FROM messages WHERE conversation_id=?").all(conversationId) as any[];
    const removeFts = connection.prepare("DELETE FROM message_fts WHERE rowid=?");
    for (const row of rows) removeFts.run(row.row_id);
    connection.prepare("DELETE FROM messages WHERE conversation_id=?").run(conversationId);
    connection.prepare("DELETE FROM outbox WHERE json_extract(payload, '$.conversationId')=?").run(conversationId);
  });
  transaction();
  return true;
}

function searchMessages(input: { query: string; conversationId?: number; limit?: number }) {
  const limit = Math.min(Math.max(input.limit || 50, 1), 100);
  const query = String(input.query || "").trim();
  if (!query) return [];
  if ([...query].length < 3) {
    const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
    const rows = input.conversationId
      ? db().prepare(`
          SELECT payload, search_text AS snippet FROM messages
          WHERE conversation_id=? AND deleted_at IS NULL
            AND (search_text LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\' OR file_name LIKE ? ESCAPE '\\')
          ORDER BY created_at DESC LIMIT ?
        `).all(input.conversationId, pattern, pattern, pattern, limit)
      : db().prepare(`
          SELECT payload, search_text AS snippet FROM messages
          WHERE deleted_at IS NULL
            AND (search_text LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\' OR file_name LIKE ? ESCAPE '\\')
          ORDER BY created_at DESC LIMIT ?
        `).all(pattern, pattern, pattern, limit);
    return rows.map((row: any) => ({ message: JSON.parse(row.payload), snippet: row.snippet }));
  }
  const ftsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, "\"\"")}"`)
    .join(" AND ");
  const rows = input.conversationId
    ? db().prepare(`
        SELECT m.payload, snippet(message_fts, 0, '<mark>', '</mark>', '…', 18) AS snippet
        FROM message_fts JOIN messages m ON m.row_id=message_fts.rowid
        WHERE message_fts MATCH ? AND m.conversation_id=? AND m.deleted_at IS NULL
        ORDER BY rank LIMIT ?
      `).all(ftsQuery, input.conversationId, limit)
    : db().prepare(`
        SELECT m.payload, snippet(message_fts, 0, '<mark>', '</mark>', '…', 18) AS snippet
        FROM message_fts JOIN messages m ON m.row_id=message_fts.rowid
        WHERE message_fts MATCH ? AND m.deleted_at IS NULL
        ORDER BY rank LIMIT ?
      `).all(ftsQuery, limit);
  return rows.map((row: any) => ({ message: JSON.parse(row.payload), snippet: row.snippet }));
}

function decodeSearchCursor(cursor?: string) {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Number.isSafeInteger(value?.offset) && value.offset >= 0 ? value.offset : 0;
  } catch {
    return 0;
  }
}

function encodeSearchCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function searchWorkspace(input: { keyword: string; cursor?: string; limit?: number }) {
  const connection = db();
  const keyword = String(input.keyword || "").trim();
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const offset = decodeSearchCursor(input.cursor);
  if (!keyword) {
    return {
      conversations: [],
      messages: [],
      nextCursor: null,
      historyComplete: getSyncState("historyComplete") === "1",
    };
  }

  const pattern = `%${keyword.replace(/[%_\\]/g, "\\$&")}%`;
  const conversations = offset === 0
    ? connection.prepare(`
        SELECT payload FROM conversations
        WHERE name LIKE ? ESCAPE '\\'
        ORDER BY hidden ASC, pinned DESC, COALESCE(last_message_at, '') DESC
        LIMIT 10
      `).all(pattern).map((row: any) => JSON.parse(row.payload))
    : [];

  let rows: any[];
  if ([...keyword].length < 3) {
    rows = connection.prepare(`
      SELECT m.payload AS message_payload, c.payload AS conversation_payload,
        m.search_text AS snippet
      FROM messages m
      JOIN conversations c ON c.id=m.conversation_id
      WHERE m.deleted_at IS NULL
        AND (
          m.search_text LIKE ? ESCAPE '\\'
          OR m.sender_name LIKE ? ESCAPE '\\'
          OR m.file_name LIKE ? ESCAPE '\\'
        )
      ORDER BY m.created_at DESC, m.row_id DESC
      LIMIT ? OFFSET ?
    `).all(pattern, pattern, pattern, limit + 1, offset);
  } else {
    const ftsQuery = keyword
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => `"${token.replace(/"/g, "\"\"")}"`)
      .join(" AND ");
    rows = connection.prepare(`
      SELECT m.payload AS message_payload, c.payload AS conversation_payload,
        snippet(message_fts, 0, '<mark>', '</mark>', '…', 18) AS snippet
      FROM message_fts
      JOIN messages m ON m.row_id=message_fts.rowid
      JOIN conversations c ON c.id=m.conversation_id
      WHERE message_fts MATCH ? AND m.deleted_at IS NULL
      ORDER BY rank, m.created_at DESC
      LIMIT ? OFFSET ?
    `).all(ftsQuery, limit + 1, offset);
  }
  const hasMore = rows.length > limit;
  return {
    conversations,
    messages: rows.slice(0, limit).map((row) => ({
      conversation: JSON.parse(row.conversation_payload),
      message: JSON.parse(row.message_payload),
      snippet: String(row.snippet || ""),
    })),
    nextCursor: hasMore ? encodeSearchCursor(offset + limit) : null,
    historyComplete: getSyncState("historyComplete") === "1",
  };
}

function encodeHistoryCursor(row: { created_at: string; row_id: number }) {
  return Buffer.from(JSON.stringify([row.created_at, row.row_id]), "utf8").toString("base64url");
}

function decodeHistoryCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || typeof value[0] !== "string" || !Number.isInteger(value[1])) {
      return null;
    }
    return { createdAt: value[0] as string, rowId: Number(value[1]) };
  } catch {
    return null;
  }
}

function queryMessageHistory(input: {
  conversationId: number;
  keyword?: string;
  senderId?: number;
  startAt?: string;
  endAt?: string;
  category?: "all" | "file" | "media";
  cursor?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const keyword = String(input.keyword || "").trim();
  const cursor = decodeHistoryCursor(input.cursor);
  const conditions = [
    "m.conversation_id=?",
    "m.deleted_at IS NULL",
    "m.server_id IS NOT NULL",
  ];
  const parameters: unknown[] = [Number(input.conversationId)];
  let join = "";
  let snippet = "m.search_text";

  if (keyword && [...keyword].length >= 3) {
    join = "JOIN message_fts ON message_fts.rowid=m.row_id";
    conditions.push("message_fts MATCH ?");
    parameters.push(
      keyword
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => `"${token.replace(/"/g, "\"\"")}"`)
        .join(" AND "),
    );
    snippet = "snippet(message_fts, 0, '<mark>', '</mark>', '…', 18)";
  } else if (keyword) {
    const pattern = `%${keyword.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(`(
      m.search_text LIKE ? ESCAPE '\\'
      OR m.sender_name LIKE ? ESCAPE '\\'
      OR m.file_name LIKE ? ESCAPE '\\'
    )`);
    parameters.push(pattern, pattern, pattern);
  }

  if (input.senderId) {
    conditions.push("m.sender_id=?");
    parameters.push(Number(input.senderId));
  }
  if (input.startAt) {
    conditions.push("m.created_at>=?");
    parameters.push(input.startAt);
  }
  if (input.endAt) {
    conditions.push("m.created_at<?");
    parameters.push(input.endAt);
  }
  if (cursor) {
    conditions.push("(m.created_at<? OR (m.created_at=? AND m.row_id<?))");
    parameters.push(cursor.createdAt, cursor.createdAt, cursor.rowId);
  }
  if (input.category === "file") {
    conditions.push(`EXISTS (
      SELECT 1 FROM json_each(m.payload, '$.parts') AS part
      WHERE json_extract(part.value, '$.type')='file'
        AND lower(COALESCE(json_extract(part.value, '$.attachment.mimeType'), ''))
          NOT LIKE 'image/%'
        AND lower(COALESCE(json_extract(part.value, '$.attachment.mimeType'), ''))
          NOT LIKE 'video/%'
    )`);
  }
  if (input.category === "media") {
    conditions.push(`EXISTS (
      SELECT 1 FROM json_each(m.payload, '$.parts') AS part
      WHERE json_extract(part.value, '$.type')='image'
        OR (
          json_extract(part.value, '$.type')='file'
          AND (
            lower(COALESCE(json_extract(part.value, '$.attachment.mimeType'), ''))
              LIKE 'image/%'
            OR lower(COALESCE(json_extract(part.value, '$.attachment.mimeType'), ''))
              LIKE 'video/%'
          )
        )
    )`);
  }

  const rows = db().prepare(`
    SELECT m.payload, m.status, m.row_id, m.created_at, ${snippet} AS snippet
    FROM messages m
    ${join}
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.created_at DESC, m.row_id DESC
    LIMIT ?
  `).all(...parameters, limit + 1) as any[];
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map((row) => ({
    message: { ...JSON.parse(row.payload), status: row.status },
    snippet: String(row.snippet || ""),
  }));
  return {
    items,
    nextCursor: rows.length > limit && pageRows.length
      ? encodeHistoryCursor(pageRows[pageRows.length - 1])
      : null,
  };
}

function getMessageContext(input: { conversationId: number; messageId: number }) {
  const connection = db();
  const target = connection.prepare(`
    SELECT row_id, created_at, payload, status FROM messages
    WHERE conversation_id=? AND server_id=? AND deleted_at IS NULL
  `).get(Number(input.conversationId), Number(input.messageId)) as any;
  if (!target) return { targetId: Number(input.messageId), items: [] };
  const older = connection.prepare(`
    SELECT row_id, created_at, payload, status FROM messages
    WHERE conversation_id=? AND deleted_at IS NULL
      AND (created_at<? OR (created_at=? AND row_id<?))
    ORDER BY created_at DESC, row_id DESC LIMIT 20
  `).all(
    Number(input.conversationId),
    target.created_at,
    target.created_at,
    target.row_id,
  ) as any[];
  const newer = connection.prepare(`
    SELECT row_id, created_at, payload, status FROM messages
    WHERE conversation_id=? AND deleted_at IS NULL
      AND (created_at>? OR (created_at=? AND row_id>?))
    ORDER BY created_at ASC, row_id ASC LIMIT 20
  `).all(
    Number(input.conversationId),
    target.created_at,
    target.created_at,
    target.row_id,
  ) as any[];
  const rows = [...older.reverse(), target, ...newer];
  return {
    targetId: Number(input.messageId),
    items: rows.map((row) => ({ ...JSON.parse(row.payload), status: row.status })),
  };
}

interface ImageCursor {
  createdAt: string;
  rowId: number;
  partIndex: number;
}

function encodeImageCursor(value: ImageCursor) {
  return Buffer.from(JSON.stringify([
    value.createdAt,
    value.rowId,
    value.partIndex,
  ])).toString("base64url");
}

function decodeImageCursor(value?: string): ImageCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !Array.isArray(parsed)
      || typeof parsed[0] !== "string"
      || !Number.isInteger(parsed[1])
      || !Number.isInteger(parsed[2])
    ) {
      return null;
    }
    return {
      createdAt: parsed[0],
      rowId: Number(parsed[1]),
      partIndex: Number(parsed[2]),
    };
  } catch {
    return null;
  }
}

function imageGalleryItem(row: any) {
  const part = JSON.parse(String(row.part_json || "{}"));
  const attachment = part.attachment || {};
  return {
    key: `attachment:${Number(attachment.id)}`,
    conversationId: Number(row.conversation_id),
    messageId: Number(row.server_id),
    attachmentId: Number(attachment.id),
    originalName: String(attachment.originalName || "图片"),
    mimeType: String(attachment.mimeType || "application/octet-stream"),
    width: Math.max(1, Number(part.width) || 1),
    height: Math.max(1, Number(part.height) || 1),
    createdAt: String(row.created_at),
  };
}

function queryImageGallery(input: {
  conversationId: number;
  attachmentId?: number;
  direction?: "initial" | "previous" | "next";
  cursor?: string;
  limit?: number;
}) {
  const connection = db();
  const conversationId = Number(input.conversationId);
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const base = `
    FROM messages m, json_each(m.payload, '$.parts') AS part
    WHERE m.conversation_id=?
      AND m.kind IN ('user', 'announcement')
      AND m.status='sent'
      AND m.server_id IS NOT NULL
      AND m.deleted_at IS NULL
      AND json_extract(part.value, '$.type')='image'
      AND CAST(json_extract(part.value, '$.attachment.id') AS INTEGER)>0
  `;
  const select = `
    SELECT m.row_id, m.server_id, m.conversation_id, m.created_at,
      CAST(part.key AS INTEGER) AS part_index,
      part.value AS part_json
  `;
  const cursor = decodeImageCursor(input.cursor);
  const direction = input.direction || "initial";
  const historyComplete = getSyncState("historyComplete") === "1";

  const cursorCondition = (comparison: "<" | ">") => `
    AND (
      m.created_at ${comparison} ?
      OR (m.created_at=? AND m.row_id ${comparison} ?)
      OR (m.created_at=? AND m.row_id=? AND CAST(part.key AS INTEGER) ${comparison} ?)
    )
  `;
  const cursorParameters = (value: ImageCursor) => [
    value.createdAt,
    value.createdAt,
    value.rowId,
    value.createdAt,
    value.rowId,
    value.partIndex,
  ];
  const rowCursor = (row: any): ImageCursor => ({
    createdAt: String(row.created_at),
    rowId: Number(row.row_id),
    partIndex: Number(row.part_index),
  });

  if (direction === "previous" || direction === "next") {
    if (!cursor) {
      return {
        items: [],
        previousCursor: null,
        nextCursor: null,
        historyComplete,
      };
    }
    const previous = direction === "previous";
    const rows = connection.prepare(`
      ${select} ${base}
      ${cursorCondition(previous ? "<" : ">")}
      ORDER BY m.created_at ${previous ? "DESC" : "ASC"},
        m.row_id ${previous ? "DESC" : "ASC"},
        CAST(part.key AS INTEGER) ${previous ? "DESC" : "ASC"}
      LIMIT ?
    `).all(
      conversationId,
      ...cursorParameters(cursor),
      limit + 1,
    ) as any[];
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    if (previous) pageRows.reverse();
    return {
      items: pageRows.map(imageGalleryItem),
      previousCursor: previous && hasMore && pageRows.length
        ? encodeImageCursor(rowCursor(pageRows[0]))
        : null,
      nextCursor: !previous && hasMore && pageRows.length
        ? encodeImageCursor(rowCursor(pageRows[pageRows.length - 1]))
        : null,
      historyComplete,
    };
  }

  const attachmentId = Number(input.attachmentId);
  const anchor = Number.isSafeInteger(attachmentId) && attachmentId > 0
    ? connection.prepare(`
        ${select}
        FROM messages m, json_each(m.payload, '$.parts') AS part
        WHERE m.conversation_id=?
          AND m.kind IN ('user', 'announcement')
          AND m.deleted_at IS NULL
          AND json_extract(part.value, '$.type')='image'
          AND CAST(json_extract(part.value, '$.attachment.id') AS INTEGER)=?
        LIMIT 1
      `).get(conversationId, attachmentId) as any
    : undefined;
  if (!anchor) {
    const rows = connection.prepare(`
      ${select} ${base}
      ORDER BY m.created_at DESC, m.row_id DESC, CAST(part.key AS INTEGER) DESC
      LIMIT ?
    `).all(conversationId, limit + 1) as any[];
    const hasPrevious = rows.length > limit;
    const pageRows = rows.slice(0, limit).reverse();
    return {
      items: pageRows.map(imageGalleryItem),
      previousCursor: hasPrevious && pageRows.length
        ? encodeImageCursor(rowCursor(pageRows[0]))
        : null,
      nextCursor: null,
      historyComplete,
    };
  }

  const anchorCursor = rowCursor(anchor);
  const beforeLimit = Math.floor(limit / 2);
  const afterLimit = Math.max(0, limit - beforeLimit - 1);
  const beforeRows = connection.prepare(`
    ${select} ${base}
    ${cursorCondition("<")}
    ORDER BY m.created_at DESC, m.row_id DESC, CAST(part.key AS INTEGER) DESC
    LIMIT ?
  `).all(
    conversationId,
    ...cursorParameters(anchorCursor),
    beforeLimit + 1,
  ) as any[];
  const afterRows = connection.prepare(`
    ${select} ${base}
    ${cursorCondition(">")}
    ORDER BY m.created_at ASC, m.row_id ASC, CAST(part.key AS INTEGER) ASC
    LIMIT ?
  `).all(
    conversationId,
    ...cursorParameters(anchorCursor),
    afterLimit + 1,
  ) as any[];
  const hasPrevious = beforeRows.length > beforeLimit;
  const hasNext = afterRows.length > afterLimit;
  const pageRows = [
    ...beforeRows.slice(0, beforeLimit).reverse(),
    anchor,
    ...afterRows.slice(0, afterLimit),
  ];
  return {
    items: pageRows.map(imageGalleryItem),
    previousCursor: hasPrevious && pageRows.length
      ? encodeImageCursor(rowCursor(pageRows[0]))
      : null,
    nextCursor: hasNext && pageRows.length
      ? encodeImageCursor(rowCursor(pageRows[pageRows.length - 1]))
      : null,
    historyComplete,
  };
}

function enqueueMessage(input: any) {
  const message = input?.message || input;
  const command = input?.command || input;
  const connection = db();
  const transaction = connection.transaction(() => {
    upsertMessage(message, "queued", 1);
    connection.prepare(`
      INSERT INTO outbox(client_id, operation, payload, created_at)
      VALUES(?, 'message.send', ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET payload=excluded.payload, last_error=NULL
    `).run(message.clientId, JSON.stringify(command), new Date().toISOString());
  });
  transaction();
  return message;
}

function markMessage(input: { clientId: string; message?: any; status: string; error?: string }) {
  const connection = db();
  const transaction = connection.transaction(() => {
    if (input.message) upsertMessage(input.message, input.status, 1);
    else connection.prepare("UPDATE messages SET status=?, updated_at=? WHERE client_id=?")
      .run(input.status, new Date().toISOString(), input.clientId);
    if (input.status === "sent") connection.prepare("DELETE FROM outbox WHERE client_id=?").run(input.clientId);
    else connection.prepare("UPDATE outbox SET last_error=?, retry_count=retry_count+1 WHERE client_id=?")
      .run(input.error || null, input.clientId);
  });
  transaction();
  return true;
}

function getOutbox() {
  return db().prepare("SELECT payload, retry_count AS retryCount, last_error AS lastError FROM outbox ORDER BY id")
    .all().map((row: any) => ({ ...row, payload: JSON.parse(row.payload) }));
}

function hasPendingConversation(conversationId: number) {
  const row = db().prepare(`
    SELECT 1
    FROM outbox o
    JOIN messages m ON m.client_id=o.client_id
    WHERE json_extract(o.payload, '$.conversationId')=?
      AND m.status IN ('queued', 'uploading', 'sending')
    LIMIT 1
  `).get(Number(conversationId));
  return Boolean(row);
}

function cancelQueuedMessage(clientId: string) {
  const connection = db();
  const transaction = connection.transaction(() => {
    connection.prepare("DELETE FROM outbox WHERE client_id=?").run(clientId);
    const row = connection.prepare(
      "SELECT row_id FROM messages WHERE client_id=? AND server_id IS NULL",
    ).get(clientId) as { row_id: number } | undefined;
    if (!row) return;
    connection.prepare("DELETE FROM message_fts WHERE rowid=?").run(row.row_id);
    connection.prepare("DELETE FROM messages WHERE row_id=?").run(row.row_id);
  });
  transaction();
  return true;
}

function setSyncStateUnsafe(key: string, value: string, updatedAt: string) {
  db().prepare(`
    INSERT INTO sync_state(key, value, updated_at) VALUES(?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(key, value, updatedAt);
}

function setSyncState(input: { key: string; value: string }) {
  setSyncStateUnsafe(input.key, input.value, new Date().toISOString());
  return true;
}

function getSyncState(key: string) {
  const row = db().prepare("SELECT value FROM sync_state WHERE key=?").get(key) as any;
  return row?.value ?? null;
}

function setAttachmentCachePath(input: { attachmentId: number; localCachePath: string }) {
  db().prepare(`
    UPDATE attachments SET local_cache_path=?, last_accessed_at=? WHERE id=?
  `).run(input.localCachePath, new Date().toISOString(), input.attachmentId);
  return true;
}

const methods: Record<string, (args: any) => unknown> = {
  open,
  close,
  applyBootstrap,
  applyEvents,
  upsertMessages,
  listConversations,
  upsertConversations,
  replaceConversations,
  getMessages,
  getRecentUserMessages,
  clearConversationMessages,
  searchMessages,
  searchWorkspace,
  queryMessageHistory,
  getMessageContext,
  getMessage,
  queryImageGallery,
  enqueueMessage,
  markMessage,
  getOutbox,
  hasPendingConversation,
  cancelQueuedMessage,
  removeMessagesForMe,
  setSyncState,
  getSyncState,
  setAttachmentCachePath,
};

export const databaseWorkerTestApi = {
  open,
  close,
  applyBootstrap,
  applyEvents,
  upsertMessages,
  listConversations,
  getMessages,
  getRecentUserMessages,
  searchMessages,
  searchWorkspace,
  queryMessageHistory,
  getMessageContext,
  queryImageGallery,
  enqueueMessage,
  markMessage,
  getOutbox,
  hasPendingConversation,
  cancelQueuedMessage,
  getSyncState,
  setAttachmentCachePath,
  diagnostics() {
    return {
      journalMode: db().pragma("journal_mode", { simple: true }),
      foreignKeys: db().pragma("foreign_keys", { simple: true }),
      synchronous: db().pragma("synchronous", { simple: true }),
      busyTimeout: db().pragma("busy_timeout", { simple: true }),
    };
  },
};

parentPort?.on("message", async (event) => {
  const { id, method, args } = event.data;
  const response: ResponseMessage = { id };
  try {
    const handler = methods[method];
    if (!handler) throw new Error(`未知数据库操作: ${method}`);
    response.result = await handler(args);
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  parentPort?.postMessage(response);
});
