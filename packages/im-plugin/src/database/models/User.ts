/** 从服务端同步到本地的企业成员快照。 */
export interface UserRow {
  /** 服务端用户 ID。 */
  id: number;
  /** 完整用户对象的 JSON 字符串。 */
  payload: string;
  /** 本地最后更新时间，使用 ISO 8601 字符串。 */
  updatedAt: string;
}

export const userTableSql = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
