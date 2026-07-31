/** 本地同步任务的游标与完成状态。 */
export interface SyncStateRow {
  /** 同步状态键，例如 cursor 或 historyComplete。 */
  key: string;
  /** 同步状态值，统一按字符串保存。 */
  value: string;
  /** 状态最后更新时间，使用 ISO 8601 字符串。 */
  updatedAt: string;
}

export const syncStateTableSql = `
  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
