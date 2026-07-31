/** 已点击发送但尚未获得服务端 ACK 的发件箱记录。 */
export interface OutboxRow {
  /** SQLite 自增记录 ID。 */
  id: number;
  /** 客户端消息 ID，同一消息只保留一条 outbox 记录。 */
  clientId: string;
  /** 待执行操作，目前固定为 message.send。 */
  operation: "message.send";
  /** 完整 SendMessagePayload 的 JSON 字符串。 */
  payload: string;
  /** 已执行的失败重试次数。 */
  retryCount: number;
  /** 下一次自动重试时间；没有计划时为 null。 */
  nextRetryAt: string | null;
  /** 最近一次失败原因；尚未失败时为 null。 */
  lastError: string | null;
  /** outbox 记录创建时间，使用 ISO 8601 字符串。 */
  createdAt: string;
}

export const outboxTableSql = `
  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL UNIQUE,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL
  );
`;
