import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  Alert,
  Button,
  Dropdown,
  Empty,
  Input,
  message,
  Modal,
  Table,
  Tag,
  Tooltip,
  type MenuProps,
} from "antd";
import {
  Clock3,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderClock,
  MoreHorizontal,
  Plus,
  Search,
  Share2,
  Star,
  Upload,
  UsersRound,
} from "lucide-react";
import type { CloudDocument, CloudDocumentListView } from "@chat/shared";
import ShareDocumentModal from "./components/ShareDocumentModal";
import DocumentCommentsModal from "./components/DocumentCommentsModal";
import DocumentVersionsModal from "./components/DocumentVersionsModal";
import DocumentReviewModal from "./components/DocumentReviewModal";
import { ROUTES } from "../../constants/routes";
import { useDocuments } from "./hooks";
import { writeClipboardText } from "../../services/clipboard";
import "./page.less";

const views: Array<{
  key: CloudDocumentListView;
  label: string;
  icon: React.ReactNode;
}> = [
  { key: "recent", label: "最近访问", icon: <Clock3 size={17} /> },
  { key: "mine", label: "我的文档", icon: <FileText size={17} /> },
  { key: "shared", label: "与我共享", icon: <UsersRound size={17} /> },
  { key: "favorite", label: "我的收藏", icon: <Star size={17} /> },
];

/** 将文档更新时间格式化为便于扫描的中文日期。 */
function formatUpdatedAt(value: string) {
  const date = new Date(value);
  const today = new Date();
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (date.toDateString() === today.toDateString()) {
    return `今天 ${time}`;
  }
  return `${date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} ${time}`;
}

/** 组织文档目录、创建工具与列表，保留文档权限及协作操作。 */
export default function DocumentsPage() {
  const documents = useDocuments();
  const navigate = useNavigate();
  const [reviewing, setReviewing] = useState<CloudDocument | null>(null);
  const [sharing, setSharing] = useState<CloudDocument | null>(null);
  const [commenting, setCommenting] = useState<CloudDocument | null>(null);
  const [versioning, setVersioning] = useState<CloudDocument | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const data = documents.documents.data ?? [];

  const createItems: MenuProps["items"] = [
    {
      key: "doc",
      icon: <FileText size={17} className="text-[var(--app-primary)]" />,
      label: "新建在线文档",
      onClick: () => documents.createDocument.mutate("doc"),
    },
    {
      key: "sheet",
      icon: <FileSpreadsheet size={17} className="text-[var(--app-success)]" />,
      label: "新建在线表格",
      onClick: () => documents.createDocument.mutate("sheet"),
    },
  ];

  /** 根据当前文档权限构建版本、评论、分享及管理菜单。 */
  function actionItems(document: CloudDocument): MenuProps["items"] {
    return [
      {
        key: "versions",
        label: "版本历史",
        onClick: () => setVersioning(document),
      },
      {
        key: "open-new-tab",
        label: "新标签页打开",
        onClick: () => window.desktop?.windows.openDocument(document.id),
      },
      {
        key: "copy-link",
        label: "复制链接",
        onClick: () => {
          const link = `chat://app/document.html?documentId=${encodeURIComponent(document.id)}`;
          void writeClipboardText(link)
            .then(() => message.success("文档链接已复制"))
            .catch((error: Error) =>
              message.error(error.message || "复制链接失败"),
            );
        },
      },
      {
        key: "download",
        label: "下载",
        onClick: () =>
          window.desktop?.windows
            .downloadDocument({
              id: document.id,
              title: document.title,
            })
            .catch((error: Error) =>
              message.error(error.message || "下载文档失败"),
            ),
      },
      {
        key: "comments",
        label: "评论",
        onClick: () => setCommenting(document),
      },
      {
        type: "divider",
      },
      {
        key: "favorite",
        label: document.favorite ? "取消收藏" : "收藏",
        onClick: () =>
          documents.updateDocument.mutate({
            id: document.id,
            payload: { favorite: !document.favorite },
          }),
      },
      ...(document.permission !== "viewer"
        ? [
            {
              key: "review",
              label: "提交评审",
              onClick: () => setReviewing(document),
            },
            {
              key: "rename",
              label: "重命名",
              onClick: () => {
                let title = document.title;
                Modal.confirm({
                  title: "重命名文档",
                  content: (
                    <Input
                      defaultValue={title}
                      onChange={(event) => {
                        title = event.target.value;
                      }}
                    />
                  ),
                  okText: "保存",
                  onOk: () =>
                    documents.updateDocument.mutateAsync({
                      id: document.id,
                      payload: { title },
                    }),
                });
              },
            },
          ]
        : []),
      ...(document.permission === "owner"
        ? [
            {
              key: "share",
              label: "共享设置",
              onClick: () => setSharing(document),
            },
            {
              type: "divider" as const,
            },
            {
              key: "delete",
              danger: true,
              label: "移到回收站",
              onClick: () =>
                Modal.confirm({
                  title: "删除文档",
                  content: `确定将“${document.title}”移到回收站吗？`,
                  okText: "删除",
                  okButtonProps: { danger: true },
                  onOk: () => documents.deleteDocument.mutateAsync(document),
                }),
            },
          ]
        : []),
    ];
  }

  const hasTableContent = documents.documents.isLoading || data.length > 0;

  return (
    <div className="documents-page">
      <aside className="documents-directory" aria-label="文档目录">
        <div className="documents-directory-heading">
          <FileText size={19} />
          <strong>文档空间</strong>
        </div>
        <div className="grid gap-2">
          <Dropdown menu={{ items: createItems }} trigger={["click"]}>
            <Button
              type="primary"
              icon={<Plus size={17} />}
              block
              loading={documents.createDocument.isPending}
            >
              新建
            </Button>
          </Dropdown>
          <input
            ref={importInput}
            type="file"
            hidden
            accept=".doc,.docx,.docm,.dotx,.txt,.md,.rtf,.xls,.xlsx,.xlsm,.xlsb,.ods,.csv,.tsv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) documents.importDocument.mutate(file);
            }}
          />
          <Tooltip title="导入本地 Word、Excel 或文本文件">
            <Button
              icon={<Upload size={16} />}
              block
              loading={documents.importDocument.isPending}
              onClick={() => importInput.current?.click()}
            >
              导入文件
            </Button>
          </Tooltip>
        </div>
        <nav className="documents-views" aria-label="文档视图">
          {views.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-current={documents.view === item.key ? "page" : undefined}
              onClick={() => documents.setView(item.key)}
              className="documents-view"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="documents-directory-note">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--app-text)]">
            <Share2 size={16} className="text-[var(--app-primary)]" />
            多人实时协作
          </div>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--app-text-secondary)]">
            文档内容自动保存，多人编辑状态实时同步。
          </p>
        </div>
      </aside>
      <main className="workspace-page documents-main">
        <div className="documents-content">
          <header className="workspace-page-header">
            <div className="workspace-page-heading">
              <span className="workspace-eyebrow">知识与协作</span>
              <h1 className="workspace-page-title">云文档</h1>
              <p className="workspace-page-description">
                在线文档与表格，内容实时保存并支持多人协作
              </p>
            </div>
          </header>

          <section className="documents-create-grid" aria-label="快速创建">
            <button
              type="button"
              disabled={documents.createDocument.isPending}
              onClick={() => documents.createDocument.mutate("doc")}
              className="documents-create-card"
            >
              <span className="documents-create-icon">
                <FilePlus2 size={23} />
              </span>
              <span>
                <strong className="block text-sm text-[var(--app-text)]">
                  创建在线文档
                </strong>
                <small className="mt-1 block text-[var(--app-text-secondary)]">
                  撰写方案、会议纪要与知识内容
                </small>
              </span>
            </button>
            <button
              type="button"
              disabled={documents.createDocument.isPending}
              onClick={() => documents.createDocument.mutate("sheet")}
              className="documents-create-card"
            >
              <span className="documents-create-icon documents-create-icon-sheet">
                <FileSpreadsheet size={23} />
              </span>
              <span>
                <strong className="block text-sm text-[var(--app-text)]">
                  创建在线表格
                </strong>
                <small className="mt-1 block text-[var(--app-text-secondary)]">
                  协作维护数据、计划和项目清单
                </small>
              </span>
            </button>
          </section>

          <section
            className={`workspace-panel documents-table-panel ${hasTableContent ? "documents-table-panel-filled" : ""}`}
          >
            <div className="workspace-toolbar documents-toolbar">
              <div className="flex items-center gap-2">
                <FolderClock size={18} className="text-[var(--app-primary)]" />
                <strong className="text-sm text-[var(--app-text)]">
                  {views.find((item) => item.key === documents.view)?.label}
                </strong>
                <Tag bordered={false}>{data.length}</Tag>
              </div>
              <Input
                allowClear
                prefix={
                  <Search
                    size={16}
                    className="text-[var(--app-text-secondary)]"
                  />
                }
                placeholder="搜索文档"
                aria-label="搜索文档"
                value={documents.query}
                onChange={(event) => documents.setQuery(event.target.value)}
                className="documents-search"
              />
            </div>
            {documents.documents.isError && (
              <Alert
                type="error"
                showIcon
                title="文档加载失败"
                action={
                  <Button
                    size="small"
                    onClick={() => void documents.documents.refetch()}
                  >
                    重试
                  </Button>
                }
              />
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Table<CloudDocument>
                rowKey="id"
                loading={documents.documents.isLoading}
                pagination={false}
                tableLayout="fixed"
                scroll={{ x: 680 }}
                className="documents-table"
                dataSource={data}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        documents.query
                          ? "没有找到匹配的文档，试试其他关键词"
                          : "这里还没有文档，可新建或导入文件"
                      }
                    />
                  ),
                }}
                onRow={(document) => ({
                  onDoubleClick: () =>
                    window.desktop?.windows.openDocument(document.id),
                  className: "cursor-default",
                })}
                columns={[
                  {
                    title: "名称",
                    width: 260,
                    render: (_, document) => (
                      <button
                        type="button"
                        onClick={() =>
                          window.desktop?.windows.openDocument(document.id)
                        }
                        className="documents-file-button"
                      >
                        <span
                          className={`documents-file-icon ${document.type === "sheet" ? "documents-create-icon-sheet" : ""}`}
                        >
                          {document.type === "sheet" ? (
                            <FileSpreadsheet size={18} />
                          ) : (
                            <FileText size={18} />
                          )}
                        </span>
                        <span className="min-w-0">
                          <strong className="block truncate text-sm font-medium text-[var(--app-text)]">
                            {document.title}
                          </strong>
                          <small className="mt-0.5 block text-[var(--app-text-secondary)]">
                            {document.type === "sheet"
                              ? "在线表格"
                              : "在线文档"}
                          </small>
                        </span>
                      </button>
                    ),
                  },
                  {
                    title: "协作者",
                    width: 150,
                    render: (_, document) => (
                      <Avatar.Group size={26} max={{ count: 3 }}>
                        {document.members.map((member) => (
                          <Tooltip
                            key={member.userId}
                            title={`${member.name} · ${member.permission === "owner" ? "所有者" : member.permission === "editor" ? "可编辑" : "仅查看"}`}
                          >
                            <Avatar
                              style={{
                                backgroundColor: "var(--app-primary-soft)",
                                color: "var(--app-primary)",
                              }}
                            >
                              {member.avatar || member.name.slice(0, 1)}
                            </Avatar>
                          </Tooltip>
                        ))}
                      </Avatar.Group>
                    ),
                  },
                  {
                    title: "最近编辑",
                    width: 180,
                    render: (_, document) => (
                      <span className="text-xs text-[var(--app-text-secondary)]">
                        {document.lastEditor?.name || "我"} ·{" "}
                        {formatUpdatedAt(document.updatedAt)}
                      </span>
                    ),
                  },
                  {
                    title: "操作",
                    width: 92,
                    align: "right",
                    render: (_, document) => (
                      <span className="flex items-center justify-end gap-1">
                        <Button
                          type="text"
                          size="small"
                          aria-label={document.favorite ? "取消收藏" : "收藏"}
                          icon={
                            <Star
                              size={16}
                              fill={document.favorite ? "currentColor" : "none"}
                              color={
                                document.favorite
                                  ? "var(--app-primary)"
                                  : "currentColor"
                              }
                            />
                          }
                          onClick={() =>
                            documents.updateDocument.mutate({
                              id: document.id,
                              payload: { favorite: !document.favorite },
                            })
                          }
                        />
                        <Dropdown
                          menu={{ items: actionItems(document) }}
                          trigger={["click"]}
                          placement="bottomRight"
                        >
                          <Button
                            type="text"
                            size="small"
                            aria-label={`更多操作：${document.title}`}
                            icon={<MoreHorizontal size={17} />}
                          />
                        </Dropdown>
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </section>
        </div>
        <ShareDocumentModal
          document={sharing}
          onClose={() => setSharing(null)}
          onSaved={documents.refresh}
        />
        <DocumentCommentsModal
          document={commenting}
          onClose={() => setCommenting(null)}
        />
        <DocumentVersionsModal
          document={versioning}
          onClose={() => setVersioning(null)}
        />
        <DocumentReviewModal
          document={reviewing}
          onClose={() => setReviewing(null)}
          onSubmitted={(review) => {
            setReviewing(null);
            navigate(`${ROUTES.reviews}?reviewId=${review.id}`);
          }}
        />
      </main>
    </div>
  );
}
