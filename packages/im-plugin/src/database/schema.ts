import type Database from "better-sqlite3";
import {
  messageFtsTrigramTableSql,
  messageFtsUnicodeTableSql,
  tableSchemaSql,
} from "./models";

/** 初始化 SQLite 参数、普通表、索引和全文检索虚拟表。 */
export function initializeSchema(connection: Database.Database) {
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.pragma("synchronous = NORMAL");
  connection.pragma("busy_timeout = 5000");
  connection.exec(tableSchemaSql);
  const conversationColumns = connection
    .prepare("PRAGMA table_info(conversations)")
    .all() as Array<{ name: string }>;
  if (!conversationColumns.some((column) => column.name === "hidden")) {
    connection.exec("ALTER TABLE conversations ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
  }

  try {
    connection.exec(messageFtsTrigramTableSql);
  } catch {
    connection.exec(messageFtsUnicodeTableSql);
  }

  const appliedAt = new Date().toISOString();
  connection.prepare(
    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)",
  ).run(appliedAt);
  connection.prepare(
    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, ?)",
  ).run(appliedAt);
  connection.prepare(
    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(3, ?)",
  ).run(appliedAt);
}
