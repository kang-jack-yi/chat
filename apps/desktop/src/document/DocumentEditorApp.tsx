import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Input,
  Result,
  Skeleton,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  Cloud,
  CloudOff,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  Share2,
  UsersRound,
} from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import type { CloudDocument } from "@chat/shared";
import EditorToolbar from "./EditorToolbar";
import ShareModal from "./ShareModal";
import { documentApi, type DocumentHostContext } from "./api";

type CollaborationStatus = "connecting" | "connected" | "disconnected" | "synced";

interface CollaborationBundle {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
}

function userColor(userId: number) {
  const colors = ["#1677ff", "#13a36f", "#8b5cf6", "#e67e22", "#e85d75", "#0f91a6"];
  return colors[Math.abs(userId) % colors.length];
}

function CollaborativeEditor({
  document,
  bundle,
  currentUserId,
  synced,
}: {
  document: CloudDocument;
  bundle: CollaborationBundle;
  currentUserId: number;
  synced: boolean;
}) {
  const currentMember = document.members.find((member) => member.userId === currentUserId);
  const readOnly = document.permission === "viewer";
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TableKit.configure({
        table: {
          resizable: true,
          allowTableNodeSelection: true,
          cellMinWidth: 120,
        },
      }),
      Collaboration.configure({ document: bundle.ydoc }),
      CollaborationCaret.configure({
        provider: bundle.provider,
        user: {
          id: currentUserId,
          name: currentMember?.name || "协作者",
          color: userColor(currentUserId),
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: document.type === "sheet" ? "cloudEditor cloudEditorSheet" : "cloudEditor cloudEditorDoc",
      },
    },
  }, [bundle, document.id]);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (!editor || !synced || initializedRef.current) return;
    initializedRef.current = true;
    const fragment = bundle.ydoc.getXmlFragment("default");
    if (fragment.length > 0) return;
    if (document.type === "sheet") {
      editor.commands.setContent({
        type: "doc",
        content: [{ type: "paragraph" }],
      });
      editor.chain().focus().insertTable({ rows: 20, cols: 8, withHeaderRow: true }).run();
      return;
    }
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: document.title }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "在这里开始编写内容。所有修改都会实时保存，并同步给当前在线的协作者。" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "背景与目标" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "使用标题、列表、引用、链接和表格组织你的内容。" }],
        },
      ],
    });
  }, [bundle.ydoc, document.title, document.type, editor, synced]);

  if (!editor) return <Skeleton active paragraph={{ rows: 10 }} />;
  return (
    <div className="documentEditorWorkspace">
      <EditorToolbar editor={editor} documentType={document.type} readOnly={readOnly} />
      {readOnly && (
        <Alert
          banner
          showIcon
          type="info"
          message="当前为只读模式"
          description="文档所有者仅授予了查看权限。"
          className="documentReadOnly"
        />
      )}
      <div className={document.type === "sheet" ? "sheetCanvas" : "documentCanvas"}>
        <div className={document.type === "sheet" ? "sheetEditorPage" : "documentEditorPage"}>
          <EditorContent editor={editor} className="documentEditorContent" />
        </div>
      </div>
    </div>
  );
}

export default function DocumentEditorApp() {
  const [context, setContext] = useState<DocumentHostContext | null>(null);
  const [document, setDocument] = useState<CloudDocument | null>(null);
  const [bundle, setBundle] = useState<CollaborationBundle | null>(null);
  const [status, setStatus] = useState<CollaborationStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [presence, setPresence] = useState<Array<{ id?: number; name: string; color: string }>>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const titleTimer = useRef<ReturnType<typeof setTimeout>>();
  const changeTimer = useRef<ReturnType<typeof setTimeout>>();
  const documentRef = useRef<CloudDocument | null>(null);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    let disposed = false;
    let provider: HocuspocusProvider | null = null;
    let ydoc: Y.Doc | null = null;
    const bridge = window.documentDesktop;
    if (!bridge) {
      setError("当前页面必须在桌面客户端的文档窗口中打开");
      return;
    }
    const removeToken = bridge.context.onTokenUpdated((accessToken) => {
      documentApi.updateToken(accessToken);
      provider?.setConfiguration({ token: accessToken });
      void provider?.sendToken();
    });
    let closing = false;
    const removeBeforeClose = bridge.window.onBeforeClose(() => {
      if (closing) return;
      closing = true;
      void (async () => {
        provider?.flushPendingUpdates();
        const deadline = Date.now() + 1_000;
        while (provider?.hasUnsyncedChanges && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        provider?.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (documentRef.current?.id) await bridge.window.notifyChanged(documentRef.current.id);
        await bridge.window.readyToClose();
      })();
    });
    void bridge.context.get().then(async (hostContext) => {
      if (disposed) return;
      documentApi.configure(hostContext);
      setContext(hostContext);
      const config = await documentApi.detail(hostContext.documentId);
      if (disposed) return;
      setDocument(config.document);
      window.document.title = config.document.title;
      ydoc = new Y.Doc();
      const notifyAfterStored = () => {
        clearTimeout(changeTimer.current);
        changeTimer.current = setTimeout(() => {
          void bridge.window.notifyChanged(hostContext.documentId);
        }, 1_800);
      };
      ydoc.on("update", notifyAfterStored);
      provider = new HocuspocusProvider({
        url: config.collaborationUrl,
        name: `document:${hostContext.documentId}`,
        document: ydoc,
        token: () => hostContext.accessToken,
        sessionAwareness: true,
        flushDelay: false,
        onStatus: ({ status: nextStatus }) => {
          if (disposed) return;
          setStatus(nextStatus === "connected" ? "connected" : nextStatus);
        },
        onSynced: ({ state }) => {
          if (!disposed && state) {
            setSynced(true);
            setStatus("synced");
          }
        },
        onAwarenessChange: ({ states }) => {
          if (disposed) return;
          const users = states
            .map((state: any) => state.user)
            .filter(Boolean)
            .map((user: any) => ({
              id: user.id,
              name: String(user.name || "协作者"),
              color: String(user.color || "#1677ff"),
            }));
          setPresence(users);
        },
        onAuthenticationFailed: () => {
          void bridge.context.refreshToken()
            .then((accessToken) => {
              hostContext.accessToken = accessToken;
              documentApi.updateToken(accessToken);
              provider?.setConfiguration({ token: accessToken });
              return provider?.connect();
            })
            .catch((reason: Error) => setError(reason.message || "登录状态已失效"));
        },
      });
      setBundle({ ydoc, provider });
    }).catch((reason: Error) => setError(reason.message || "文档加载失败"));

    return () => {
      disposed = true;
      removeToken();
      removeBeforeClose();
      clearTimeout(titleTimer.current);
      clearTimeout(changeTimer.current);
      provider?.destroy();
      ydoc?.destroy();
    };
  }, []);

  const statusView = useMemo(() => {
    if (status === "synced") return { text: "已保存到云端", color: "#13a36f", icon: <Cloud size={15} /> };
    if (status === "connected") return { text: "正在同步", color: "#1677ff", icon: <Cloud size={15} /> };
    if (status === "connecting") return { text: "正在连接", color: "#d28a22", icon: <Cloud size={15} /> };
    return { text: "离线编辑", color: "#8a96a5", icon: <CloudOff size={15} /> };
  }, [status]);

  function changeTitle(title: string) {
    if (!document) return;
    setDocument({ ...document, title });
    window.document.title = title || "云文档";
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      if (!title.trim()) return;
      void documentApi.update(document.id, { title: title.trim() })
        .then((updatedDocument) => {
          setDocument(updatedDocument);
          return window.documentDesktop?.window.notifyChanged(updatedDocument.id);
        })
        .catch((reason: Error) => message.error(reason.message));
    }, 600);
  }

  async function downloadDocument() {
    if (!document || downloading) return;
    setDownloading(true);
    try {
      const saved = await window.documentDesktop?.window.download({
        id: document.id,
        title: document.title,
      });
      if (saved) message.success("文档已下载");
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : "文档下载失败");
    } finally {
      setDownloading(false);
    }
  }

  if (error) {
    return <Result status="error" title="文档加载失败" subTitle={error} />;
  }
  if (!context || !document || !bundle) {
    return (
      <div className="documentBoot">
        <Skeleton active paragraph={{ rows: 12 }} />
      </div>
    );
  }

  return (
    <div className="documentWindow">
      <header className="documentHeader">
        <span className={`documentTypeIcon ${document.type === "sheet" ? "isSheet" : ""}`}>
          {document.type === "sheet" ? <FileSpreadsheet size={20} /> : <FileText size={20} />}
        </span>
        <div className="documentTitleBlock">
          <Input
            variant="borderless"
            value={document.title}
            readOnly={document.permission === "viewer"}
            onChange={(event) => changeTitle(event.target.value)}
            className="documentTitleInput"
          />
          <div className="documentMeta">
            <span style={{ color: statusView.color }} className="documentSyncStatus">
              {statusView.icon}{statusView.text}
            </span>
            <span>最近编辑：{document.lastEditor?.name || "我"}</span>
            {document.permission === "viewer" && <span className="flex items-center gap-1"><Lock size={12} />只读</span>}
          </div>
        </div>
        <div className="documentHeaderActions">
          <Tooltip title={presence.length ? `${presence.length} 人在线` : "当前仅你在线"}>
            <span className="flex items-center gap-2 text-xs text-[var(--app-text-secondary)]">
              <UsersRound size={15} />
              <Avatar.Group size={28} max={{ count: 4 }}>
                {(presence.length ? presence : document.members.slice(0, 1)).map((user, index) => (
                  <Avatar
                    key={`${user.id || index}-${user.name}`}
                    style={{ background: "color" in user ? user.color : userColor(user.userId) }}
                  >
                    {user.name.slice(0, 1)}
                  </Avatar>
                ))}
              </Avatar.Group>
            </span>
          </Tooltip>
          <Tag bordered={false} color={document.type === "sheet" ? "green" : "blue"}>
            {document.type === "sheet" ? "在线表格" : "在线文档"}
          </Tag>
          <Button icon={<Download size={16} />} loading={downloading} onClick={downloadDocument}>
            下载
          </Button>
          {document.permission === "owner" && (
            <Button type="primary" icon={<Share2 size={16} />} onClick={() => setShareOpen(true)}>
              分享
            </Button>
          )}
        </div>
      </header>
      <CollaborativeEditor
        document={document}
        bundle={bundle}
        currentUserId={context.account.userId}
        synced={synced}
      />
      <ShareModal
        document={document}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onChange={setDocument}
      />
    </div>
  );
}
