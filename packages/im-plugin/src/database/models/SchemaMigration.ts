/** 本地数据库迁移执行记录。 */
export interface SchemaMigrationRow {
  /** 迁移版本号，版本只能向前递增。 */
  version: number;
  /** 迁移完成时间，使用 ISO 8601 字符串。 */
  appliedAt: string;
}

export const schemaMigrationTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`;
