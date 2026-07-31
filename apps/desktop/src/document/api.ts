import type {
  ApiResponse,
  CloudDocument,
  CloudDocumentEditorConfig,
  CloudDocumentPermission,
  User,
} from "@chat/shared";

interface DocumentHostContext {
  documentId: number;
  serverUrl: string;
  accessToken: string;
  account: {
    serverId: string;
    companyId: number;
    userId: number;
  };
}

class DocumentApi {
  private context: DocumentHostContext | null = null;

  configure(context: DocumentHostContext) {
    this.context = context;
  }

  updateToken(accessToken: string) {
    if (this.context) this.context.accessToken = accessToken;
  }

  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    if (!this.context) throw new Error("文档窗口尚未初始化");
    const response = await fetch(`${this.context.serverUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${this.context.accessToken}`,
        ...init.headers,
      },
    });
    if (response.status === 401 && retry) {
      const accessToken = await window.documentDesktop!.context.refreshToken();
      this.updateToken(accessToken);
      return this.request<T>(path, init, false);
    }
    const payload = await response.json() as ApiResponse<T>;
    if (!payload.success) throw new Error(payload.error.message);
    return payload.data;
  }

  detail(documentId: number) {
    return this.request<CloudDocumentEditorConfig>(`/api/documents/${documentId}`);
  }

  update(documentId: number, payload: Partial<Pick<CloudDocument, "title" | "color" | "icon">>) {
    return this.request<CloudDocument>(`/api/documents/${documentId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  users() {
    return this.request<User[]>("/api/users");
  }

  share(
    documentId: number,
    members: Array<{
      userId: number;
      permission: Exclude<CloudDocumentPermission, "owner">;
    }>,
  ) {
    return this.request<CloudDocument>(`/api/documents/${documentId}/members`, {
      method: "PUT",
      body: JSON.stringify({ members }),
    });
  }
}

export const documentApi = new DocumentApi();
export type { DocumentHostContext };
