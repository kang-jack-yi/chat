import type { WorkspaceSearchPage, WorkspaceSearchType } from "@chat/shared";
import { get } from "./request";

export interface WorkspaceSearchQuery {
  q: string;
  type: "all" | WorkspaceSearchType;
  limit: number;
  offset: number;
}

/** 按关键词、类型和分页参数隔离缓存，避免旧搜索结果覆盖当前结果。 */
export function workspaceSearchKey(query: WorkspaceSearchQuery) {
  return ["workspace-search", query.q, query.type, query.limit, query.offset] as const;
}

export const searchService = {
  /** 在当前用户权限范围内检索工作区内容，并支持取消过期请求。 */
  search: (query: WorkspaceSearchQuery, signal?: AbortSignal) =>
    get<WorkspaceSearchPage>("/api/search", { params: query, signal }),
};
