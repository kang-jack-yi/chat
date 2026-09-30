import type {
  CloudDocument,
  CloudDocumentEditorConfig,
  CloudDocumentListView,
  CloudDocumentPermission,
  CloudDocumentType,
  DocumentComment,
  DocumentVersion,
  DocumentVersionPreview,
} from "@chat/shared";
import { get, patch, post, put, remove } from "./request";

export const documentsService = {
  list: (view: CloudDocumentListView, query = "") =>
    get<CloudDocument[]>("/api/documents", {
      params: { view, ...(query ? { q: query } : {}) },
    }),
  create: (type: CloudDocumentType) =>
    post<CloudDocument>("/api/documents", { type }),
  importFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return post<CloudDocument>("/api/documents/import", form, {
      timeout: 60_000,
    });
  },
  detail: (id: number) =>
    get<CloudDocumentEditorConfig>(`/api/documents/${id}`),
  update: (
    id: number,
    payload: Partial<
      Pick<CloudDocument, "title" | "color" | "icon" | "favorite">
    >,
  ) => patch<CloudDocument>(`/api/documents/${id}`, payload),
  share: (
    id: number,
    members: Array<{
      userId: number;
      permission: Exclude<CloudDocumentPermission, "owner">;
    }>,
  ) => put<CloudDocument>(`/api/documents/${id}/members`, { members }),
  remove: (id: number) => remove<boolean>(`/api/documents/${id}`),
  comments: (id: number) =>
    get<DocumentComment[]>(`/api/documents/${id}/comments`),
  /** 读取当前文档的版本历史摘要。 */
  versions: (id: number) =>
    get<DocumentVersion[]>(`/api/documents/${id}/versions`),
  /** 为当前内容保存可命名的手动版本。 */
  createVersion: (id: number, label: string) =>
    post<DocumentVersion>(`/api/documents/${id}/versions`, { label }),
  /** 获取历史版本的纯文本预览。 */
  previewVersion: (id: number, versionId: number) =>
    get<DocumentVersionPreview>(`/api/documents/${id}/versions/${versionId}`),
  /** 恢复历史版本，服务器会先自动备份当前内容。 */
  restoreVersion: (id: number, versionId: number) =>
    post<{ documentId: number; restoredVersionId: number }>(
      `/api/documents/${id}/versions/${versionId}/restore`,
    ),
  createComment: (
    id: number,
    payload: {
      content: string;
      anchor?: string | null;
      parentId?: number | null;
    },
  ) => post<DocumentComment>(`/api/documents/${id}/comments`, payload),
  updateComment: (documentId: number, commentId: number, resolved: boolean) =>
    patch<DocumentComment>(
      `/api/documents/${documentId}/comments/${commentId}`,
      { resolved },
    ),
};
