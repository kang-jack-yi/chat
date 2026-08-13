import { useRef, useState } from "react";
import {
  Avatar,
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
import { useDocuments } from "./hooks";
import { writeClipboardText } from "../../services/clipboard";

const views: Array<{ key: CloudDocumentListView; label: string; icon: React.ReactNode }> = [
  { key: "recent", label: "最近访问", icon: <Clock3 size={17} /> },
  { key: "mine", label: "我的文档", icon: <FileText size={17} /> },
  { key: "shared", label: "与我共享", icon: <UsersRound size={17} /> },
  { key: "favorite", label: "我的收藏", icon: <Star size={17} /> },
];

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

export default function DocumentsPage() {
  const documents = useDocuments();
  const [sharing, setSharing] = useState<CloudDocument | null>(null);
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
      icon: <FileSpreadsheet size={17} className="text-[#13a36f]" />,
      label: "新建在线表格",
      onClick: () => documents.createDocument.mutate("sheet"),
    },
  ];

  function actionItems(document: CloudDocument): MenuProps["items"] {
    return [
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
            .catch((error: Error) => message.error(error.message || "复制链接失败"));
        },
      },
      {
        key: "download",
        label: "下载",
        onClick: () => window.desktop?.windows.downloadDocument({
          id: document.id,
          title: document.title,
        })
          .catch((error: Error) => message.error(error.message || "下载文档失败")),
      },
      {
        type: "divider",
      },
      {
        key: "favorite",
        label: document.favorite ? "取消收藏" : "收藏",
        onClick: () => documents.updateDocument.mutate({
          id: document.id,
          payload: { favorite: !document.favorite },
        }),
      },
      ...(document.permission !== "viewer" ? [{
        key: "rename",
        label: "重命名",
        onClick: () => {
          let title = document.title;
          Modal.confirm({
            title: "重命名文档",
            content: <Input defaultValue={title} onChange={(event) => { title = event.target.value; }} />,
            okText: "保存",
            onOk: () => documents.updateDocument.mutateAsync({
              id: document.id,
              payload: { title },
            }),
          });
        },
      }] : []),
      ...(document.permission === "owner" ? [{
        key: "share",
        label: "共享设置",
        onClick: () => setSharing(document),
      }, {
        type: "divider" as const,
      }, {
        key: "delete",
        danger: true,
        label: "移到回收站",
        onClick: () => Modal.confirm({
          title: "删除文档",
          content: `确定将“${document.title}”移到回收站吗？`,
          okText: "删除",
          okButtonProps: { danger: true },
          onOk: () => documents.deleteDocument.mutateAsync(document),
        }),
      }] : []),
    ];
  }

  return (
    <div className="grid h-full grid-cols-[224px_minmax(0,1fr)] bg-[var(--app-canvas)]">
      <aside className="flex min-h-0 flex-col border-r border-[var(--app-line)] bg-[var(--app-surface-soft)] p-4">
        <div className="grid gap-2">
          <Dropdown menu={{ items: createItems }} trigger={["click"]}>
            <Button type="primary" icon={<Plus size={17} />} block loading={documents.createDocument.isPending}>
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
              上传
            </Button>
          </Tooltip>
        </div>
        <nav className="mt-6 grid gap-1">
          {views.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => documents.setView(item.key)}
              className={`flex h-10 items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors ${
                documents.view === item.key
                  ? "bg-[var(--app-primary-soft)] font-medium text-[var(--app-primary)]"
                  : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text)]"
              }`}
            >
              {item.icon}{item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] p-3 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--app-text)]">
            <Share2 size={16} className="text-[var(--app-primary)]" />多人实时协作
          </div>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--app-text-secondary)]">
            文档内容自动保存，多人编辑状态实时同步。
          </p>
        </div>
      </aside>
      <main className="min-w-0 overflow-y-auto px-[clamp(28px,4vw,58px)] py-8">
        <div className="mx-auto max-w-[1180px]">
          <header className="flex items-start justify-between gap-6">
            <div>
              <h1 className="m-0 text-[26px] font-semibold tracking-[-.4px] text-[var(--app-text)]">云文档</h1>
              <p className="mb-0 mt-1 text-sm text-[var(--app-text-secondary)]">
                在线文档与表格，内容实时保存并支持多人协作
              </p>
            </div>
            <Input
              allowClear
              prefix={<Search size={16} className="text-[var(--app-text-tertiary)]" />}
              placeholder="搜索文档"
              value={documents.query}
              onChange={(event) => documents.setQuery(event.target.value)}
              className="!w-[320px]"
            />
          </header>

          <section className="mt-7 grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => documents.createDocument.mutate("doc")}
              className="group flex items-center gap-4 rounded-[14px] border border-[var(--app-line)] bg-[var(--app-surface)] p-5 text-left shadow-[var(--app-shadow-panel)] transition-colors hover:border-[var(--app-primary)] hover:bg-[var(--app-surface-soft)]"
            >
              <span className="grid size-12 place-items-center rounded-xl bg-[var(--app-primary-soft)] text-[var(--app-primary)]"><FilePlus2 size={23} /></span>
              <span><strong className="block text-sm text-[var(--app-text)]">创建在线文档</strong><small className="mt-1 block text-[var(--app-text-secondary)]">撰写方案、会议纪要与知识内容</small></span>
            </button>
            <button
              type="button"
              onClick={() => documents.createDocument.mutate("sheet")}
              className="group flex items-center gap-4 rounded-[14px] border border-[var(--app-line)] bg-[var(--app-surface)] p-5 text-left shadow-[var(--app-shadow-panel)] transition-colors hover:border-[var(--app-primary)] hover:bg-[var(--app-surface-soft)]"
            >
              <span className="grid size-12 place-items-center rounded-xl bg-[#e8f8f2] text-[#13a36f]"><FileSpreadsheet size={23} /></span>
              <span><strong className="block text-sm text-[var(--app-text)]">创建在线表格</strong><small className="mt-1 block text-[var(--app-text-secondary)]">协作维护数据、计划和项目清单</small></span>
            </button>
          </section>

          <section className="mt-7 overflow-hidden rounded-[14px] border border-[var(--app-line)] bg-[var(--app-surface)] shadow-[var(--app-shadow-panel)]">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-4">
              <div className="flex items-center gap-2">
                <FolderClock size={18} className="text-[var(--app-primary)]" />
                <strong className="text-sm text-[var(--app-text)]">
                  {views.find((item) => item.key === documents.view)?.label}
                </strong>
                <Tag bordered={false}>{data.length}</Tag>
              </div>
            </div>
            <Table<CloudDocument>
              rowKey="id"
              loading={documents.documents.isLoading}
              pagination={false}
              dataSource={data}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这里还没有文档" /> }}
              onRow={(document) => ({
                onDoubleClick: () => window.desktop?.windows.openDocument(document.id),
                className: "cursor-default",
              })}
              columns={[
                {
                  title: "名称",
                  render: (_, document) => (
                    <button
                      type="button"
                      onClick={() => window.desktop?.windows.openDocument(document.id)}
                      className="flex min-w-0 items-center gap-3 text-left"
                    >
                      <span
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-white"
                        style={{ background: document.color }}
                      >
                        {document.type === "sheet" ? <FileSpreadsheet size={18} /> : <FileText size={18} />}
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-sm font-medium text-[var(--app-text)]">{document.title}</strong>
                        <small className="mt-0.5 block text-[var(--app-text-secondary)]">
                          {document.type === "sheet" ? "在线表格" : "在线文档"}
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
                        <Tooltip key={member.userId} title={`${member.name} · ${member.permission === "owner" ? "所有者" : member.permission === "editor" ? "可编辑" : "仅查看"}`}>
                          <Avatar>{member.avatar || member.name.slice(0, 1)}</Avatar>
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
                      {document.lastEditor?.name || "我"} · {formatUpdatedAt(document.updatedAt)}
                    </span>
                  ),
                },
                {
                  title: "",
                  width: 92,
                  align: "right",
                  render: (_, document) => (
                    <span className="flex items-center justify-end gap-1">
                      <Button
                        type="text"
                        size="small"
                        aria-label={document.favorite ? "取消收藏" : "收藏"}
                        icon={<Star size={16} fill={document.favorite ? "#f3b23d" : "none"} color={document.favorite ? "#f3b23d" : "currentColor"} />}
                        onClick={() => documents.updateDocument.mutate({
                          id: document.id,
                          payload: { favorite: !document.favorite },
                        })}
                      />
                      <Dropdown menu={{ items: actionItems(document) }} trigger={["click"]}>
                        <Button type="text" size="small" icon={<MoreHorizontal size={17} />} />
                      </Dropdown>
                    </span>
                  ),
                },
              ]}
            />
          </section>
        </div>
        <ShareDocumentModal
          document={sharing}
          onClose={() => setSharing(null)}
          onSaved={documents.refresh}
        />
      </main>
    </div>
  );
}
