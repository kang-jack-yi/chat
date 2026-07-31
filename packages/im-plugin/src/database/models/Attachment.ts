/** 已上传附件及其本地缓存状态。 */
export interface AttachmentRow {
  /** 服务端附件 ID。 */
  id: number;
  /** 绑定的服务端消息 ID；未绑定消息时为 null。 */
  messageServerId: number | null;
  /** 完整附件元数据的 JSON 字符串。 */
  payload: string;
  /** 主进程内部使用的本地缓存路径；Renderer 不可读取。 */
  localCachePath: string | null;
  /** 缓存最后访问时间；从未访问时为 null。 */
  lastAccessedAt: string | null;
}

export const attachmentTableSql = `
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY,
    message_server_id INTEGER,
    payload TEXT NOT NULL,
    local_cache_path TEXT,
    last_accessed_at TEXT
  );
`;
