import type { Application } from "egg";
import crypto from "node:crypto";
import type { Transaction } from "sequelize";
import { Op } from "sequelize";
import { toPlain } from "./database";
import { appendConversationSyncEvents } from "./sync";

type SystemActor = {
  userId: number;
  name: string;
};

export type SystemMessageEvent =
  | { type: "group_created"; actor: SystemActor; invitedMembers: SystemActor[] }
  | { type: "members_invited"; actor: SystemActor; members: SystemActor[] }
  | { type: "member_left"; actor: SystemActor }
  | { type: "member_removed"; actor: SystemActor; member: SystemActor }
  | { type: "group_renamed"; actor: SystemActor; oldName: string; newName: string }
  | { type: "group_announcement_updated"; actor: SystemActor }
  | { type: "owner_transferred"; actor: SystemActor; newOwner: SystemActor }
  | { type: "message_recalled"; actor: SystemActor; targetMessageId: number };

type StoredPart =
  | { type: "text"; text: string }
  | { type: "markdown"; content: string }
  | { type: "mention"; userId: number; label: string }
  | { type: "mention_all"; label: "所有人" }
  | { type: "image"; attachmentId: number; width: number; height: number }
  | { type: "file"; attachmentId: number }
  | { type: "quote"; messageId: number }
  | { type: "system_event"; event: SystemMessageEvent }
  | { type: "forwarded_message"; snapshot: StoredForwardMessageSnapshot }
  | { type: "chat_record"; title: string; items: StoredForwardMessageSnapshot[] };

type StoredForwardSnapshotPart =
  | { type: "text"; text: string }
  | { type: "markdown"; content: string }
  | { type: "mention"; userId: number; label: string }
  | { type: "mention_all"; label: "所有人" }
  | { type: "image"; attachmentId: number; width: number; height: number }
  | { type: "file"; attachmentId: number }
  | { type: "quote_snapshot"; senderName: string; summary: string };

type StoredForwardMessageSnapshot = {
  originalMessageId: number;
  senderId: number;
  senderName: string;
  senderAvatar: string;
  createdAt: string;
  summary: string;
  parts: StoredForwardSnapshotPart[];
};

function messageError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

function parseStoredParts(value: unknown): StoredPart[] {
  if (Array.isArray(value)) return value as StoredPart[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseMessageIds(value: unknown) {
  if (typeof value === "string") {
    try {
      return parseMessageIds(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
    : [];
}

export function membershipMessageVisibility(membership: any) {
  const visibleAfter = Number(
    membership?.get?.("historyVisibleAfterMessageId")
    ?? membership?.historyVisibleAfterMessageId
    ?? 0,
  );
  if (!visibleAfter) return {};
  const invitedIds = parseMessageIds(
    membership?.get?.("invitedHistoryMessageIds")
    ?? membership?.invitedHistoryMessageIds,
  );
  return {
    [Op.or]: [
      { id: { [Op.gt]: visibleAfter } },
      ...(invitedIds.length ? [{ id: { [Op.in]: invitedIds } }] : []),
    ],
  };
}

export function membershipCanAccessMessage(membership: any, messageId: number) {
  const visibleAfter = Number(
    membership?.get?.("historyVisibleAfterMessageId")
    ?? membership?.historyVisibleAfterMessageId
    ?? 0,
  );
  if (!visibleAfter || messageId > visibleAfter) return true;
  const invitedIds = parseMessageIds(
    membership?.get?.("invitedHistoryMessageIds")
    ?? membership?.invitedHistoryMessageIds,
  );
  return invitedIds.includes(messageId);
}

export async function userDeletedMessageIds(
  app: Application,
  userId: number,
  conversationId: number,
) {
  const rows = await app.chatDb.MessageUserState.findAll({
    where: { userId, conversationId },
    attributes: ["messageId"],
  });
  return rows.map((row: any) => Number(row.get("messageId")));
}

function normalizeOutgoingParts(value: unknown): StoredPart[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw messageError(400, "INVALID_MESSAGE_PARTS", "消息内容不能为空");
  }
  let quoteCount = 0;
  let fileCount = 0;
  let totalTextLength = 0;
  const parts = value.map((part: any, index) => {
    if (!part || typeof part !== "object") {
      throw messageError(400, "INVALID_MESSAGE_PART", "消息片段格式不正确");
    }
    if (part.type === "text") {
      const text = String(part.text || "").replace(/\r\n/g, "\n");
      totalTextLength += text.length;
      return { type: "text", text } as StoredPart;
    }
    if (part.type === "mention") {
      const userId = Number(part.userId);
      const label = String(part.label || "").trim().slice(0, 80);
      if (!Number.isSafeInteger(userId) || userId <= 0 || !label) {
        throw messageError(400, "INVALID_MENTION", "@成员信息不正确");
      }
      return { type: "mention", userId, label } as StoredPart;
    }
    if (part.type === "mention_all") {
      if (part.label !== "所有人") {
        throw messageError(400, "INVALID_MENTION", "@所有人信息不正确");
      }
      return { type: "mention_all", label: "所有人" } as StoredPart;
    }
    if (part.type === "image") {
      const attachmentId = Number(part.attachmentId);
      const width = Math.max(1, Math.min(Number(part.width) || 1, 20_000));
      const height = Math.max(1, Math.min(Number(part.height) || 1, 20_000));
      if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) {
        throw messageError(400, "INVALID_ATTACHMENT", "图片附件不正确");
      }
      return { type: "image", attachmentId, width, height } as StoredPart;
    }
    if (part.type === "file") {
      fileCount += 1;
      const attachmentId = Number(part.attachmentId);
      if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) {
        throw messageError(400, "INVALID_ATTACHMENT", "文件附件不正确");
      }
      return { type: "file", attachmentId } as StoredPart;
    }
    if (part.type === "quote") {
      quoteCount += 1;
      const messageId = Number(part.messageId);
      if (index !== 0 || !Number.isSafeInteger(messageId) || messageId <= 0) {
        throw messageError(400, "INVALID_QUOTE", "引用消息必须位于消息开头");
      }
      return { type: "quote", messageId } as StoredPart;
    }
    throw messageError(400, "UNSUPPORTED_MESSAGE_PART", "暂不支持该消息类型");
  });

  if (quoteCount > 1 || totalTextLength > 20_000) {
    throw messageError(400, "INVALID_MESSAGE_PARTS", "消息内容过长或引用数量不正确");
  }
  if (!parts.some((part) => part.type !== "quote" && (part.type !== "text" || part.text.trim()))) {
    throw messageError(400, "EMPTY_MESSAGE", "消息内容不能为空");
  }
  if (fileCount && (fileCount !== 1 || parts.some((part) => !["file", "quote"].includes(part.type)))) {
    throw messageError(400, "INVALID_FILE_MESSAGE", "普通文件必须单独发送");
  }
  return parts;
}

function attachmentDto(attachment: any) {
  return {
    id: Number(attachment.id),
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    size: Number(attachment.size),
    url: `/api/files/${attachment.id}`,
  };
}

function displayMembers(members: SystemActor[]) {
  const names = members.slice(0, 5).map((member) => member.name).join("、");
  return members.length > 5 ? `${names} 等 ${members.length} 人` : names;
}

export function systemMessageSummary(event: SystemMessageEvent) {
  if (event.type === "group_announcement_updated") {
    return `${event.actor.name}更新了群公告`;
  }
  if (event.type === "owner_transferred") {
    return `${event.actor.name}将群主转让给${event.newOwner.name}`;
  }
  if (event.type === "group_created") {
    const invited = displayMembers(event.invitedMembers);
    return invited
      ? `${event.actor.name}创建了群聊，并邀请${invited}加入群聊`
      : `${event.actor.name}创建了群聊`;
  }
  if (event.type === "members_invited") {
    return `${event.actor.name}邀请${displayMembers(event.members)}加入群聊`;
  }
  if (event.type === "member_left") return `${event.actor.name}退出了群聊`;
  if (event.type === "member_removed") {
    return `${event.actor.name}将${event.member.name}移出了群聊`;
  }
  if (event.type === "group_renamed") {
    return `${event.actor.name}将群名修改为“${event.newName}”`;
  }
  return `${event.actor.name}撤回了一条消息`;
}

function systemMessageSearchText(event: SystemMessageEvent) {
  if (event.type === "group_announcement_updated") {
    return `${event.actor.name} 更新群公告`;
  }
  if (event.type === "owner_transferred") {
    return `${event.actor.name} ${event.newOwner.name} 转让群主`;
  }
  if (event.type === "group_created") {
    return [event.actor.name, ...event.invitedMembers.map((member) => member.name), "创建群聊", "邀请成员"].join(" ");
  }
  if (event.type === "members_invited") {
    return [event.actor.name, ...event.members.map((member) => member.name), "邀请成员", "加入群聊"].join(" ");
  }
  if (event.type === "member_removed") {
    return `${event.actor.name} ${event.member.name} 移出群聊`;
  }
  if (event.type === "group_renamed") {
    return `${event.actor.name} ${event.oldName} ${event.newName} 修改群名`;
  }
  return systemMessageSummary(event);
}

function buildSummary(parts: StoredPart[], attachmentMap: Map<number, any>) {
  const summary = parts.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "markdown") return part.content.replace(/<[^>]+>/g, "").replace(/[*_#>`\[\]()]/g, " ");
    if (part.type === "mention") return `@${part.label}`;
    if (part.type === "mention_all") return "@所有人";
    if (part.type === "image") return "[图片]";
    if (part.type === "file") {
      return `[文件] ${attachmentMap.get(part.attachmentId)?.originalName || "附件"}`;
    }
    if (part.type === "system_event") return systemMessageSummary(part.event);
    if (part.type === "forwarded_message") return part.snapshot.summary;
    if (part.type === "chat_record") return `[聊天记录] ${part.title}`;
    return "";
  }).join("").replace(/\s+/g, " ").trim();
  return summary.slice(0, 100) || "[消息]";
}

function collectAttachmentIds(parts: StoredPart[]) {
  const ids: number[] = [];
  const collectSnapshot = (snapshot: StoredForwardMessageSnapshot) => {
    for (const part of snapshot.parts) {
      if (part.type === "image" || part.type === "file") ids.push(part.attachmentId);
    }
  };
  for (const part of parts) {
    if (part.type === "image" || part.type === "file") ids.push(part.attachmentId);
    if (part.type === "forwarded_message") collectSnapshot(part.snapshot);
    if (part.type === "chat_record") part.items.forEach(collectSnapshot);
  }
  return [...new Set(ids)];
}

export async function serializeMessage(
  app: Application,
  row: any,
  transaction?: Transaction,
) {
  const message = toPlain(row);
  const storedParts = parseStoredParts(message.payloadJson);
  const attachmentIds = collectAttachmentIds(storedParts);
  const attachments = attachmentIds.length
    ? await app.chatDb.Attachment.findAll({
        where: { id: attachmentIds },
        order: [["id", "ASC"]],
        transaction,
      })
    : [];
  const attachmentMap = new Map(attachments.map((item: any) => {
    const plain = toPlain(item);
    return [Number(plain.id), plain];
  }));
  const quoteIds = storedParts
    .filter((part): part is Extract<StoredPart, { type: "quote" }> => part.type === "quote")
    .map((part) => part.messageId);
  const quotedRows = quoteIds.length
    ? await app.chatDb.Message.findAll({
        where: { id: quoteIds, conversationId: message.conversationId },
        transaction,
      })
    : [];
  const quoteMap = new Map<number, any>();
  for (const quotedRow of quotedRows) {
    const quoted = toPlain(quotedRow);
    const quotedBot = quoted.senderType === "bot" && quoted.senderBotId
      ? toPlain(await app.chatDb.ConversationBot.findByPk(quoted.senderBotId, { transaction }))
      : null;
    const quotedSender = quoted.senderType === "bot"
      ? null
      : toPlain(await app.chatDb.User.findByPk(quoted.senderId, { transaction }));
    quoteMap.set(Number(quoted.id), {
      messageId: Number(quoted.id),
      senderId: Number(quoted.senderId),
      senderName: quoted.senderType === "bot"
        ? String(quoted.senderName || quotedBot?.name || "机器人")
        : quotedSender?.name || "未知成员",
      summary: quoted.summary || "[消息]",
    });
  }
  const senderType = message.senderType === "bot" ? "bot" : "user";
  const sender = senderType === "user"
    ? toPlain(await app.chatDb.User.findByPk(message.senderId, { transaction }))
    : null;
  const bot = senderType === "bot" && message.senderBotId
    ? toPlain(await app.chatDb.ConversationBot.findByPk(message.senderBotId, { transaction }))
    : null;
  const serializeSnapshot = (snapshot: StoredForwardMessageSnapshot) => ({
    ...snapshot,
    parts: snapshot.parts.flatMap<any>((part) => {
      if (part.type === "image") {
        const attachment = attachmentMap.get(part.attachmentId);
        return attachment ? [{
          type: "image" as const,
          attachment: attachmentDto(attachment),
          width: part.width,
          height: part.height,
        }] : [];
      }
      if (part.type === "file") {
        const attachment = attachmentMap.get(part.attachmentId);
        return attachment ? [{
          type: "file" as const,
          attachment: attachmentDto(attachment),
        }] : [];
      }
      return [part];
    }),
  });
  const parts = storedParts.flatMap((part) => {
    if (part.type === "image") {
      const attachment = attachmentMap.get(part.attachmentId);
      return attachment ? [{
        type: "image",
        attachment: attachmentDto(attachment),
        width: part.width,
        height: part.height,
      }] : [];
    }
    if (part.type === "file") {
      const attachment = attachmentMap.get(part.attachmentId);
      return attachment ? [{ type: "file", attachment: attachmentDto(attachment) }] : [];
    }
    if (part.type === "quote") {
      const quote = quoteMap.get(part.messageId);
      return quote ? [{ type: "quote", ...quote }] : [];
    }
    if (part.type === "forwarded_message") {
      return [{ type: "forwarded_message", snapshot: serializeSnapshot(part.snapshot) }];
    }
    if (part.type === "chat_record") {
      return [{
        type: "chat_record",
        title: part.title,
        items: part.items.map(serializeSnapshot),
      }];
    }
    return [part];
  });
  return {
    schemaVersion: 1 as const,
    id: Number(message.id),
    clientId: message.clientId,
    conversationId: Number(message.conversationId),
    senderId: Number(message.senderId),
    senderType,
    senderBotId: message.senderBotId ? Number(message.senderBotId) : null,
    senderName: senderType === "bot" ? String(message.senderName || bot?.name || "机器人") : sender?.name || "未知成员",
    senderAvatar: senderType === "bot" ? String(message.senderAvatar || bot?.avatar || "机") : sender?.avatar || "?",
    senderBot: senderType === "bot" ? {
      id: Number(message.senderBotId || bot?.id || 0),
      name: String(message.senderName || bot?.name || "机器人"),
      avatar: String(message.senderAvatar || bot?.avatar || "机"),
    } : null,
    kind: message.kind || "user",
    parts,
    summary: message.summary || buildSummary(storedParts, attachmentMap),
    version: Number(message.version || 1),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    deletedAt: message.deletedAt || null,
  };
}

export async function createSystemMessage(
  app: Application,
  input: {
    companyId: number;
    conversationId: number;
    event: SystemMessageEvent;
  },
  transaction: Transaction,
) {
  const summary = systemMessageSummary(input.event);
  const row = await app.chatDb.Message.create({
    companyId: input.companyId,
    conversationId: input.conversationId,
    senderId: input.event.actor.userId,
    clientId: `system:${crypto.randomUUID()}`,
    kind: "system",
    schemaVersion: 1,
    payloadJson: [{ type: "system_event", event: input.event }],
    summary,
    searchText: systemMessageSearchText(input.event),
    version: 1,
  }, { transaction });
  const conversation = await app.chatDb.Conversation.findByPk(input.conversationId, { transaction });
  await conversation?.update({
    lastMessage: summary,
    lastMessageAt: row.get("createdAt"),
  }, { transaction });
  const messagePayload = await serializeMessage(app, row);
  await appendConversationSyncEvents(app, {
    companyId: input.companyId,
    conversationId: input.conversationId,
    type: "message.upsert",
    entityId: String(row.get("id")),
    version: 1,
    payload: messagePayload,
  }, transaction);
  await appendConversationSyncEvents(app, {
    companyId: input.companyId,
    conversationId: input.conversationId,
    type: "conversation.upsert",
    entityId: String(input.conversationId),
    version: Date.now(),
    payload: { id: input.conversationId },
  }, transaction);
  return messagePayload;
}

async function withReadStatus(app: Application, message: any) {
  const memberships = await app.chatDb.ConversationMember.findAll({
    where: { conversationId: message.conversationId, leftAt: null },
  });
  const recipients = memberships.filter((item: any) => Number(item.get("userId")) !== message.senderId);
  return {
    ...message,
    readCount: recipients.filter((item: any) => Number(item.get("lastReadMessageId") || 0) >= message.id).length,
    recipientCount: recipients.length,
  };
}

export async function recallMessage(
  app: Application,
  user: any,
  conversationId: number,
  messageId: number,
) {
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0
    || !Number.isSafeInteger(messageId) || messageId <= 0) {
    throw messageError(400, "INVALID_MESSAGE", "消息参数不正确");
  }
  const [membership, conversation] = await Promise.all([
    app.chatDb.ConversationMember.findOne({
      where: { conversationId, userId: user.id, leftAt: null },
    }),
    app.chatDb.Conversation.findOne({
      where: { id: conversationId, companyId: user.companyId },
    }),
  ]);
  if (!membership || !conversation) throw messageError(403, "NOT_A_MEMBER", "你不在该会话中");

  const transaction = await app.chatDb.sequelize.transaction();
  try {
    const row = await app.chatDb.Message.findOne({
      where: { id: messageId, conversationId, companyId: user.companyId },
      transaction,
    });
    if (!row) throw messageError(404, "MESSAGE_NOT_FOUND", "消息不存在");
    if (Number(row.get("senderId")) !== Number(user.id)) {
      throw messageError(403, "RECALL_FORBIDDEN", "只能撤回自己发送的消息");
    }
    if (row.get("kind") !== "user" || row.get("deletedAt")) {
      throw messageError(409, "MESSAGE_NOT_RECALLABLE", "该消息无法撤回");
    }
    const createdAt = new Date(String(row.get("createdAt"))).getTime();
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > 2 * 60 * 1000) {
      throw messageError(409, "RECALL_EXPIRED", "消息发送超过 2 分钟，无法撤回");
    }

    const recalledAt = new Date();
    const nextVersion = Number(row.get("version") || 1) + 1;
    await row.update({ deletedAt: recalledAt, version: nextVersion }, { transaction });
    await appendConversationSyncEvents(app, {
      companyId: user.companyId,
      conversationId,
      type: "message.delete",
      entityId: String(messageId),
      version: nextVersion,
      payload: { id: messageId, deletedAt: recalledAt.toISOString() },
    }, transaction);
    const systemMessage = await createSystemMessage(app, {
      companyId: user.companyId,
      conversationId,
      event: {
        type: "message_recalled",
        actor: { userId: Number(user.id), name: String(user.name) },
        targetMessageId: messageId,
      },
    }, transaction);
    await transaction.commit();
    return { recalledMessageId: messageId, systemMessage };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function createMessage(
  app: Application,
  user: any,
  payload: any,
  options: { kind?: "user" | "announcement"; ownerOnly?: boolean } = {},
) {
  const kind = options.kind || "user";
  const conversationId = Number(payload?.conversationId);
  const clientId = String(payload?.clientId || "").trim();
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0 || !clientId || clientId.length > 80) {
    throw messageError(400, "INVALID_MESSAGE", "消息参数不完整");
  }
  if (Number(payload?.schemaVersion) !== 1) {
    throw messageError(400, "UNSUPPORTED_MESSAGE_VERSION", "消息版本不受支持");
  }
  const parts = normalizeOutgoingParts(payload.parts);
  const member = await app.chatDb.ConversationMember.findOne({
    where: { conversationId, userId: user.id, leftAt: null },
  });
  const conversation = await app.chatDb.Conversation.findOne({
    where: { id: conversationId, companyId: user.companyId },
  });
  if (!member || !conversation) throw messageError(403, "NOT_A_MEMBER", "你不在该会话中");
  if (kind === "announcement") {
    if (conversation.get("type") !== "group") {
      throw messageError(400, "INVALID_ANNOUNCEMENT", "只有群聊可以发布群公告");
    }
    if (options.ownerOnly && Number(conversation.get("createdBy")) !== Number(user.id)) {
      throw messageError(403, "OWNER_REQUIRED", "只有群主可以发布群公告");
    }
    if (parts.some((part) => part.type === "quote" || part.type === "file")) {
      throw messageError(400, "INVALID_ANNOUNCEMENT_PART", "群公告支持文字、表情、@成员和图片");
    }
  }

  const existing = await app.chatDb.Message.findOne({ where: { clientId } });
  if (existing) return withReadStatus(app, await serializeMessage(app, existing));

  const mentionIds = [...new Set(parts
    .filter((part): part is Extract<StoredPart, { type: "mention" }> => part.type === "mention")
    .map((part) => part.userId))];
  const mentionAll = parts.some((part) => part.type === "mention_all");
  if ((mentionIds.length || mentionAll) && conversation.get("type") !== "group") {
    throw messageError(400, "INVALID_MENTION", "仅群聊支持@成员");
  }
  const activeMemberships = await app.chatDb.ConversationMember.findAll({
    where: { conversationId, leftAt: null },
    attributes: ["userId"],
  });
  const activeMembershipIds = activeMemberships.map((item: any) => Number(item.get("userId")));
  const activeUsers = activeMembershipIds.length
    ? await app.chatDb.User.findAll({
        where: {
          id: { [Op.in]: activeMembershipIds },
          companyId: user.companyId,
          status: "active",
        },
      })
    : [];
  const activeUserMap = new Map(activeUsers.map((item: any) => {
    const plain = toPlain(item);
    return [Number(plain.id), plain];
  }));
  if (mentionIds.length) {
    if (mentionIds.some((id) => !activeUserMap.has(id))) {
      throw messageError(400, "INVALID_MENTION", "@成员不在当前会话");
    }
    for (const part of parts) {
      if (part.type === "mention") part.label = String(activeUserMap.get(part.userId)?.name || "");
    }
  }
  const quoteIds = parts
    .filter((part): part is Extract<StoredPart, { type: "quote" }> => part.type === "quote")
    .map((part) => part.messageId);
  if (quoteIds.length) {
    const quoteCount = await app.chatDb.Message.count({
      where: { id: { [Op.in]: quoteIds }, conversationId, deletedAt: null },
    });
    if (quoteCount !== quoteIds.length) throw messageError(400, "INVALID_QUOTE", "引用消息不存在");
  }
  const attachmentIds = [...new Set(parts
    .filter((part): part is Extract<StoredPart, { attachmentId: number }> =>
      part.type === "image" || part.type === "file")
    .map((part) => part.attachmentId))];
  const attachmentRows = attachmentIds.length
    ? await app.chatDb.Attachment.findAll({
        where: {
          id: { [Op.in]: attachmentIds },
          companyId: user.companyId,
          uploaderId: user.id,
          messageId: null,
        },
      })
    : [];
  if (attachmentRows.length !== attachmentIds.length) {
    throw messageError(400, "INVALID_ATTACHMENT", "附件不存在、已使用或无权访问");
  }
  const attachmentMap = new Map(attachmentRows.map((row: any) => {
    const plain = toPlain(row);
    return [Number(plain.id), plain];
  }));
  for (const part of parts) {
    if (part.type !== "image" && part.type !== "file") continue;
    const attachment = attachmentMap.get(part.attachmentId);
    const image = String(attachment?.mimeType || "").startsWith("image/");
    if ((part.type === "image" && !image) || (part.type === "file" && image)) {
      throw messageError(400, "INVALID_ATTACHMENT_TYPE", "附件类型与消息片段不匹配");
    }
  }

  const summary = buildSummary(parts, attachmentMap);
  const searchText = parts.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "mention") return part.label;
    if (part.type === "mention_all") return "所有人";
    if (part.type === "file") return attachmentMap.get(part.attachmentId)?.originalName || "";
    return "";
  }).join(" ").trim();
  const transaction = await app.chatDb.sequelize.transaction();
  try {
    const row = await app.chatDb.Message.create({
      companyId: user.companyId,
      conversationId,
      senderId: user.id,
      clientId,
      kind,
      schemaVersion: 1,
      payloadJson: parts,
      summary,
      searchText,
      version: 1,
    }, { transaction });
    if (attachmentRows.length) {
      await app.chatDb.Attachment.update(
        { messageId: row.get("id") },
        { where: { id: { [Op.in]: attachmentIds }, messageId: null }, transaction },
      );
    }
    const messageId = Number(row.get("id"));
    const memberships = await app.chatDb.ConversationMember.findAll({
      where: { conversationId, leftAt: null },
      transaction,
    });
    for (const membership of memberships) {
      const recipientId = Number(membership.get("userId"));
      if (recipientId === Number(user.id)) continue;
      const activeRecipient = activeUserMap.has(recipientId);
      const directMention = activeRecipient && mentionIds.includes(recipientId);
      await membership.update({
        isHidden: false,
        hiddenAtMessageId: null,
        ...(directMention || (mentionAll && activeRecipient)
          ? {
              lastMentionMessageId: messageId,
              lastMentionType: directMention ? "member" : "all",
            }
          : {}),
      }, { transaction });
    }
    const conversationSummary = kind === "announcement" ? `[群公告] ${summary}` : summary;
    await conversation.update({
      lastMessage: conversationSummary,
      lastMessageAt: new Date(),
      ...(kind === "announcement"
        ? { announcement: summary, announcementMessageId: messageId }
        : {}),
    }, { transaction });
    const rowData = toPlain(row);
    const messagePayload = await serializeMessage(app, row);
    await appendConversationSyncEvents(app, {
      companyId: user.companyId,
      conversationId,
      type: "message.upsert",
      entityId: String(row.get("id")),
      version: 1,
      payload: { ...messagePayload, createdAt: rowData.createdAt },
    }, transaction);
    await appendConversationSyncEvents(app, {
      companyId: user.companyId,
      conversationId,
      type: "conversation.upsert",
      entityId: String(conversationId),
      version: Date.now(),
      payload: { id: conversationId },
    }, transaction);
    await transaction.commit();
    return withReadStatus(app, await serializeMessage(app, row));
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function createBotMessage(
  app: Application,
  bot: any,
  parts: StoredPart[],
  attachments: any[] = [],
) {
  const botData = toPlain(bot);
  const conversation = await app.chatDb.Conversation.findOne({
    where: { id: botData.conversationId, companyId: botData.companyId },
  });
  if (!conversation) throw messageError(404, "CONVERSATION_NOT_FOUND", "会话不存在");
  const attachmentMap = new Map(attachments.map((row: any) => {
    const item = toPlain(row);
    return [Number(item.id), item];
  }));
  const summary = buildSummary(parts, attachmentMap);
  const searchText = [botData.name, ...parts.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "markdown") return part.content.replace(/<[^>]+>/g, "");
    if (part.type === "file") return attachmentMap.get(part.attachmentId)?.originalName || "";
    return "";
  })].join(" ").trim();
  const transaction = await app.chatDb.sequelize.transaction();
  try {
    const row = await app.chatDb.Message.create({
      companyId: botData.companyId,
      conversationId: botData.conversationId,
      senderId: 0,
      senderType: "bot",
      senderBotId: botData.id,
      senderName: botData.name,
      senderAvatar: botData.avatar,
      clientId: `bot:${botData.id}:${crypto.randomUUID()}`,
      kind: "user",
      schemaVersion: 1,
      payloadJson: parts,
      summary,
      searchText,
      version: 1,
    }, { transaction });
    if (attachments.length) {
      await app.chatDb.Attachment.update(
        { messageId: row.get("id") },
        { where: { id: attachments.map((item: any) => Number(item.get("id"))) }, transaction },
      );
    }
    const messageId = Number(row.get("id"));
    const memberships = await app.chatDb.ConversationMember.findAll({
      where: { conversationId: botData.conversationId, leftAt: null },
      transaction,
    });
    for (const membership of memberships) {
      const recipientId = Number(membership.get("userId"));
      const wasHidden = Boolean(membership.get("isHidden"));
      await membership.update({
        // 新的机器人消息与普通消息一样恢复被隐藏的会话。
        isHidden: false,
        hiddenAtMessageId: null,
        ...(wasHidden ? { clearedAtMessageId: null } : {}),
      }, { transaction });
      // Bot is virtual: all normal members are recipients, including the creator.
      void recipientId;
    }
    await conversation.update({ lastMessage: summary, lastMessageAt: new Date() }, { transaction });
    const message = await serializeMessage(app, row, transaction);
    await appendConversationSyncEvents(app, {
      companyId: botData.companyId,
      conversationId: botData.conversationId,
      type: "message.upsert",
      entityId: String(messageId),
      version: 1,
      payload: message,
    }, transaction);
    await appendConversationSyncEvents(app, {
      companyId: botData.companyId,
      conversationId: botData.conversationId,
      type: "conversation.upsert",
      entityId: String(botData.conversationId),
      version: Date.now(),
      payload: { id: botData.conversationId },
    }, transaction);
    await transaction.commit();
    return withReadStatus(app, message);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function snapshotSearchText(snapshot: StoredForwardMessageSnapshot) {
  return [
    snapshot.senderName,
    ...snapshot.parts.map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "markdown") return part.content;
      if (part.type === "mention") return part.label;
      if (part.type === "mention_all") return "所有人";
      if (part.type === "quote_snapshot") return `${part.senderName} ${part.summary}`;
      return "";
    }),
  ].join(" ").trim();
}

async function cloneForwardSnapshot(
  app: Application,
  snapshot: any,
  companyId: number,
  uploaderId: number,
  transaction: Transaction,
) {
  const attachmentIds: number[] = [];
  const attachmentNames: string[] = [];
  const parts: StoredForwardSnapshotPart[] = [];
  for (const part of snapshot.parts || []) {
    if (part.type === "text") {
      parts.push({ type: "text", text: String(part.text || "") });
    } else if (part.type === "markdown") {
      parts.push({ type: "markdown", content: String(part.content || "") });
    } else if (part.type === "mention") {
      parts.push({
        type: "mention",
        userId: Number(part.userId),
        label: String(part.label || ""),
      });
    } else if (part.type === "mention_all") {
      parts.push({ type: "mention_all", label: "所有人" });
    } else if (part.type === "quote") {
      parts.push({
        type: "quote_snapshot",
        senderName: String(part.senderName || "未知成员"),
        summary: String(part.summary || "[消息]"),
      });
    } else if (part.type === "quote_snapshot") {
      parts.push({
        type: "quote_snapshot",
        senderName: String(part.senderName || "未知成员"),
        summary: String(part.summary || "[消息]"),
      });
    } else if (part.type === "image" || part.type === "file") {
      const sourceId = Number(part.attachment?.id);
      const source = sourceId
        ? await app.chatDb.Attachment.findOne({
            where: { id: sourceId, companyId },
            transaction,
          })
        : null;
      if (!source) continue;
      const data = toPlain(source);
      const clone = await app.chatDb.Attachment.create({
        companyId,
        uploaderId,
        messageId: null,
        originalName: data.originalName,
        storedName: data.storedName,
        mimeType: data.mimeType,
        size: data.size,
        relativePath: data.relativePath,
      }, { transaction });
      const attachmentId = Number(clone.get("id"));
      attachmentIds.push(attachmentId);
      attachmentNames.push(String(data.originalName || ""));
      if (part.type === "image") {
        parts.push({
          type: "image",
          attachmentId,
          width: Math.max(1, Number(part.width) || 1),
          height: Math.max(1, Number(part.height) || 1),
        });
      } else {
        parts.push({ type: "file", attachmentId });
      }
    }
  }
  return {
    snapshot: {
      originalMessageId: Number(snapshot.originalMessageId),
      senderId: Number(snapshot.senderId),
      senderName: String(snapshot.senderName || "未知成员"),
      senderAvatar: String(snapshot.senderAvatar || "?"),
      createdAt: String(snapshot.createdAt || new Date().toISOString()),
      summary: String(snapshot.summary || "[消息]"),
      parts,
    } satisfies StoredForwardMessageSnapshot,
    attachmentIds,
    searchText: [
      snapshotSearchText({
        originalMessageId: Number(snapshot.originalMessageId),
        senderId: Number(snapshot.senderId),
        senderName: String(snapshot.senderName || "未知成员"),
        senderAvatar: String(snapshot.senderAvatar || "?"),
        createdAt: String(snapshot.createdAt || new Date().toISOString()),
        summary: String(snapshot.summary || "[消息]"),
        parts,
      }),
      ...attachmentNames,
    ].filter(Boolean).join(" "),
  };
}

function sourceSnapshot(message: any): any {
  const forwarded = message.parts?.find((part: any) => part.type === "forwarded_message");
  if (forwarded?.snapshot) return forwarded.snapshot;
  const chatRecord = message.parts?.find((part: any) => part.type === "chat_record");
  if (chatRecord) {
    return {
      originalMessageId: Number(message.id),
      senderId: Number(message.senderId),
      senderName: String(message.senderName || "未知成员"),
      senderAvatar: String(message.senderAvatar || "?"),
      createdAt: String(message.createdAt),
      summary: String(message.summary || `[聊天记录] ${chatRecord.title || "聊天记录"}`),
      parts: [{
        type: "text",
        text: String(message.summary || `[聊天记录] ${chatRecord.title || "聊天记录"}`),
      }],
    };
  }
  return {
    originalMessageId: Number(message.id),
    senderId: Number(message.senderId),
    senderName: String(message.senderName || "未知成员"),
    senderAvatar: String(message.senderAvatar || "?"),
    createdAt: String(message.createdAt),
    summary: String(message.summary || "[消息]"),
    parts: (message.parts || []).filter((part: any) =>
      ["text", "mention", "mention_all", "image", "file", "quote", "quote_snapshot"].includes(part.type)),
  };
}

export async function forwardMessages(
  app: Application,
  user: any,
  sourceConversationId: number,
  input: {
    requestId: string;
    messageIds: number[];
    targetConversationIds: number[];
    mode: "individual" | "merged";
  },
) {
  const requestId = String(input.requestId || "").trim();
  const messageIds = [...new Set((input.messageIds || []).map(Number))];
  const targetConversationIds = [...new Set((input.targetConversationIds || []).map(Number))];
  if (
    !/^[a-zA-Z0-9-]{8,64}$/.test(requestId)
    || !Number.isSafeInteger(sourceConversationId)
    || sourceConversationId <= 0
    || messageIds.length < 1
    || messageIds.length > 30
    || targetConversationIds.length < 1
    || targetConversationIds.length > 9
    || !["individual", "merged"].includes(input.mode)
  ) {
    throw messageError(400, "INVALID_FORWARD", "转发参数不正确");
  }
  const sourceMembership = await app.chatDb.ConversationMember.findOne({
    where: { conversationId: sourceConversationId, userId: user.id, leftAt: null },
  });
  const sourceConversation = await app.chatDb.Conversation.findOne({
    where: { id: sourceConversationId, companyId: user.companyId },
  });
  if (!sourceMembership || !sourceConversation) {
    throw messageError(403, "FORWARD_FORBIDDEN", "你无权转发这些消息");
  }
  const clearedAt = Number(sourceMembership.get("clearedAtMessageId") || 0);
  const deletedIds = new Set(await userDeletedMessageIds(app, Number(user.id), sourceConversationId));
  const sourceRows = await app.chatDb.Message.findAll({
    where: {
      id: { [Op.in]: messageIds },
      conversationId: sourceConversationId,
      kind: { [Op.in]: ["user", "announcement"] },
      deletedAt: null,
    },
    order: [["id", "ASC"]],
  });
  if (
    sourceRows.length !== messageIds.length
    || sourceRows.some((row: any) => {
      const id = Number(row.get("id"));
      return id <= clearedAt
        || deletedIds.has(id)
        || !membershipCanAccessMessage(sourceMembership, id);
    })
  ) {
    throw messageError(400, "INVALID_FORWARD_MESSAGES", "部分消息不存在或不可转发");
  }
  const targetMemberships = await app.chatDb.ConversationMember.findAll({
    where: {
      conversationId: { [Op.in]: targetConversationIds },
      userId: user.id,
      leftAt: null,
    },
  });
  const targetConversations = await app.chatDb.Conversation.findAll({
    where: {
      id: { [Op.in]: targetConversationIds },
      companyId: user.companyId,
    },
  });
  if (
    targetMemberships.length !== targetConversationIds.length
    || targetConversations.length !== targetConversationIds.length
  ) {
    throw messageError(403, "FORWARD_TARGET_FORBIDDEN", "部分目标会话不可用");
  }

  const serializedSources = await Promise.all(
    sourceRows.map((row: any) => serializeMessage(app, row)),
  );
  let sourceTitle = String(sourceConversation.get("name") || "").trim();
  if (!sourceTitle && sourceConversation.get("type") === "direct") {
    const sourceMembers = await app.chatDb.ConversationMember.findAll({
      where: { conversationId: sourceConversationId, leftAt: null },
      attributes: ["userId"],
    });
    const sourceUsers = await app.chatDb.User.findAll({
      where: {
        id: { [Op.in]: sourceMembers.map((member: any) => Number(member.get("userId"))) },
      },
      attributes: ["name"],
      order: [["id", "ASC"]],
    });
    sourceTitle = sourceUsers.map((member: any) => String(member.get("name"))).join("和");
  }
  if (!sourceTitle) sourceTitle = "聊天";
  const transaction = await app.chatDb.sequelize.transaction();
  const deliveries: Array<{ conversationId: number; rows: any[] }> = [];
  try {
    for (const targetConversationId of targetConversationIds) {
      const target = targetConversations.find((row: any) =>
        Number(row.get("id")) === targetConversationId)!;
      const rows: any[] = [];
      const sourceGroups = input.mode === "merged"
        ? [serializedSources]
        : serializedSources.map((message) => [message]);
      for (let index = 0; index < sourceGroups.length; index += 1) {
        const group = sourceGroups[index];
        const clientId = `forward:${crypto.createHash("sha256")
          .update(`${requestId}:${targetConversationId}:${index}`)
          .digest("hex")
          .slice(0, 56)}`;
        const existing = await app.chatDb.Message.findOne({
          where: { clientId },
          transaction,
        });
        if (existing) {
          rows.push(existing);
          continue;
        }
        const snapshots: StoredForwardMessageSnapshot[] = [];
        const attachmentIds: number[] = [];
        const snapshotSearchTexts: string[] = [];
        for (const message of group) {
          const cloned = await cloneForwardSnapshot(
            app,
            sourceSnapshot(message),
            Number(user.companyId),
            Number(user.id),
            transaction,
          );
          snapshots.push(cloned.snapshot);
          attachmentIds.push(...cloned.attachmentIds);
          snapshotSearchTexts.push(cloned.searchText);
        }
        const storedPart: StoredPart = input.mode === "merged"
          ? {
              type: "chat_record",
              title: `${sourceTitle}的聊天记录`,
              items: snapshots,
            }
          : { type: "forwarded_message", snapshot: snapshots[0] };
        const summary = input.mode === "merged"
          ? `[聊天记录] ${sourceTitle}`
          : snapshots[0].summary;
        const row = await app.chatDb.Message.create({
          companyId: user.companyId,
          conversationId: targetConversationId,
          senderId: user.id,
          clientId,
          kind: "user",
          schemaVersion: 1,
          payloadJson: [storedPart],
          summary,
          searchText: snapshotSearchTexts.join(" "),
          version: 1,
        }, { transaction });
        if (attachmentIds.length) {
          await app.chatDb.Attachment.update(
            { messageId: Number(row.get("id")) },
            { where: { id: { [Op.in]: attachmentIds } }, transaction },
          );
        }
        const message = await serializeMessage(app, row, transaction);
        await appendConversationSyncEvents(app, {
          companyId: user.companyId,
          conversationId: targetConversationId,
          type: "message.upsert",
          entityId: String(row.get("id")),
          version: 1,
          payload: message,
        }, transaction);
        rows.push(row);
      }
      const lastRow = rows.at(-1);
      if (lastRow) {
        await target.update({
          lastMessage: String(lastRow.get("summary") || "[消息]"),
          lastMessageAt: new Date(),
        }, { transaction });
        await app.chatDb.ConversationMember.update(
          { isHidden: false, hiddenAtMessageId: null },
          {
            where: {
              conversationId: targetConversationId,
              userId: { [Op.ne]: user.id },
              leftAt: null,
            },
            transaction,
          },
        );
        await appendConversationSyncEvents(app, {
          companyId: user.companyId,
          conversationId: targetConversationId,
          type: "conversation.upsert",
          entityId: String(targetConversationId),
          version: Date.now(),
          payload: { id: targetConversationId },
        }, transaction);
      }
      deliveries.push({ conversationId: targetConversationId, rows });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
  return {
    deliveries: await Promise.all(deliveries.map(async (delivery) => ({
      conversationId: delivery.conversationId,
      messages: await Promise.all(delivery.rows.map((row) => serializeMessage(app, row))),
    }))),
  };
}
