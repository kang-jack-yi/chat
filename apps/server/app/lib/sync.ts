import type { Application } from "egg";
import type { Transaction } from "sequelize";
import { toPlain } from "./database";

export async function appendConversationSyncEvents(
  app: Application,
  input: {
    companyId: number;
    conversationId: number;
    type: string;
    entityId: string;
    payload: unknown;
    version?: number;
  },
  transaction?: Transaction,
) {
  const memberships = await app.chatDb.ConversationMember.findAll({
    where: { conversationId: input.conversationId, leftAt: null },
    transaction,
  });
  if (!memberships.length) return [];
  return app.chatDb.SyncEvent.bulkCreate(
    memberships.map((membership: any) => ({
      companyId: input.companyId,
      recipientUserId: Number(membership.get("userId")),
      type: input.type,
      entityId: input.entityId,
      conversationId: input.conversationId,
      version: input.version || 1,
      payload: input.payload,
    })),
    { transaction },
  );
}

export async function appendCompanySyncEvents(
  app: Application,
  input: {
    companyId: number;
    type: string;
    entityId: string;
    payload: unknown;
    version?: number;
  },
  transaction?: Transaction,
) {
  const users = await app.chatDb.User.findAll({
    where: { companyId: input.companyId },
    attributes: ["id"],
    transaction,
  });
  if (!users.length) return [];
  return app.chatDb.SyncEvent.bulkCreate(
    users.map((user: any) => ({
      companyId: input.companyId,
      recipientUserId: Number(user.get("id")),
      type: input.type,
      entityId: input.entityId,
      version: input.version || 1,
      payload: input.payload,
    })),
    { transaction },
  );
}

export async function appendUserSyncEvent(
  app: Application,
  input: {
    companyId: number;
    recipientUserId: number;
    type: string;
    entityId: string;
    conversationId?: number;
    payload: unknown;
    version?: number;
  },
  transaction?: Transaction,
) {
  return app.chatDb.SyncEvent.create({
    companyId: input.companyId,
    recipientUserId: input.recipientUserId,
    type: input.type,
    entityId: input.entityId,
    conversationId: input.conversationId || null,
    version: input.version || 1,
    payload: input.payload,
  }, { transaction });
}

export function serializeSyncEvent(row: any) {
  const event = toPlain(row);
  return {
    seq: Number(event.id),
    type: event.type,
    entityId: event.entityId,
    conversationId: event.conversationId ? Number(event.conversationId) : undefined,
    version: Number(event.version || 1),
    payload: event.payload,
    occurredAt: event.createdAt,
  };
}
