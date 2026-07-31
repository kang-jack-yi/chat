export * from "./Attachment";
export * from "./Conversation";
export * from "./ConversationMember";
export * from "./Department";
export * from "./LocalMeta";
export * from "./Message";
export * from "./MessageFts";
export * from "./Outbox";
export * from "./ReadState";
export * from "./SchemaMigration";
export * from "./SyncState";
export * from "./User";

import { attachmentTableSql } from "./Attachment";
import { conversationTableSql } from "./Conversation";
import { conversationMemberTableSql } from "./ConversationMember";
import { departmentTableSql } from "./Department";
import { localMetaTableSql } from "./LocalMeta";
import { messageTableSql } from "./Message";
import { outboxTableSql } from "./Outbox";
import { readStateTableSql } from "./ReadState";
import { schemaMigrationTableSql } from "./SchemaMigration";
import { syncStateTableSql } from "./SyncState";
import { userTableSql } from "./User";

/** 按依赖顺序排列的全部普通表与索引建表语句。 */
export const tableSchemaSql = [
  schemaMigrationTableSql,
  localMetaTableSql,
  userTableSql,
  departmentTableSql,
  conversationTableSql,
  conversationMemberTableSql,
  messageTableSql,
  attachmentTableSql,
  readStateTableSql,
  outboxTableSql,
  syncStateTableSql,
].join("\n");
