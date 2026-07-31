import type {
  CloudDocument,
  CloudDocumentEditorConfig,
  CloudDocumentListView,
  CloudDocumentPermission,
  CloudDocumentType,
} from "@chat/shared";
import { get, patch, post, put, remove } from "./request";

export const documentsService = {
  list: (view: CloudDocumentListView, query = "") =>
    get<CloudDocument[]>("/api/documents", {
      params: { view, ...(query ? { q: query } : {}) },
    }),
  create: (type: CloudDocumentType) =>
    post<CloudDocument>("/api/documents", { type }),
  detail: (id: number) =>
    get<CloudDocumentEditorConfig>(`/api/documents/${id}`),
  update: (
    id: number,
    payload: Partial<Pick<CloudDocument, "title" | "color" | "icon" | "favorite">>,
  ) => patch<CloudDocument>(`/api/documents/${id}`, payload),
  share: (
    id: number,
    members: Array<{ userId: number; permission: Exclude<CloudDocumentPermission, "owner"> }>,
  ) => put<CloudDocument>(`/api/documents/${id}/members`, { members }),
  remove: (id: number) => remove<boolean>(`/api/documents/${id}`),
};
