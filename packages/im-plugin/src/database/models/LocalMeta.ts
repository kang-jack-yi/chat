/** 当前本地数据库所属账号与服务器等元数据。 */
export interface LocalMetaRow {
  /** 元数据键，例如 serverId、companyId 或 userId。 */
  key: string;
  /** 元数据值，统一按字符串保存。 */
  value: string;
}

export const localMetaTableSql = `
  CREATE TABLE IF NOT EXISTS local_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;
