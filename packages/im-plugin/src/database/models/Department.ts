/** 从服务端同步到本地的部门快照。 */
export interface DepartmentRow {
  /** 服务端部门 ID。 */
  id: number;
  /** 完整部门对象的 JSON 字符串。 */
  payload: string;
  /** 本地最后更新时间，使用 ISO 8601 字符串。 */
  updatedAt: string;
}

export const departmentTableSql = `
  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
