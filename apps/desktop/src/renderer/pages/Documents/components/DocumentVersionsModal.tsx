import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Skeleton,
  Tag,
  message,
} from "antd";
import { History, Save } from "lucide-react";
import type { CloudDocument } from "@chat/shared";
import { documentsService } from "../../../services/documents";

/** 显示版本历史、纯文本预览、手动保存及带确认的安全恢复入口。 */
export default function DocumentVersionsModal({
  document,
  onClose,
}: {
  document: CloudDocument | null;
  onClose: () => void;
}) {
  // 文档作为 key 挂载独立面板，防止切换文档时继承旧选中版本和草稿。
  return (
    <Modal
      open={Boolean(document)}
      title={
        <span className="flex items-center gap-2">
          <History size={18} />
          {document?.title} · 版本历史
        </span>
      }
      width={880}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
    >
      {document && <VersionsPanel key={document.id} document={document} />}
    </Modal>
  );
}

/** 按文档和版本区分查询缓存，避免异步请求返回后展示其他版本内容。 */
function VersionsPanel({ document }: { document: CloudDocument }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<number>();
  const [label, setLabel] = useState("");
  const versions = useQuery({
    queryKey: ["document-versions", document.id],
    queryFn: () => documentsService.versions(document.id),
  });
  const preview = useQuery({
    queryKey: ["document-version", document.id, selected],
    queryFn: () => documentsService.previewVersion(document.id, selected!),
    enabled: Boolean(selected),
  });
  const editable = document.permission !== "viewer";
  const save = useMutation({
    mutationFn: () => documentsService.createVersion(document.id, label.trim()),
    onSuccess: async (version) => {
      setLabel("");
      setSelected(version.id);
      await client.invalidateQueries({
        queryKey: ["document-versions", document.id],
      });
      message.success("版本已保存");
    },
    onError: (error: Error) => message.error(error.message),
  });
  const restore = useMutation({
    mutationFn: (id: number) =>
      documentsService.restoreVersion(document.id, id),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ["document-versions", document.id],
      });
      await client.invalidateQueries({ queryKey: ["documents"] });
      message.success("已恢复，可重新打开文档查看");
    },
    onError: (error: Error) => message.error(error.message),
  });
  /** 恢复前确认影响，并明确在线编辑窗口必须先关闭。 */
  function confirmRestore() {
    if (!selected) return;
    const versionId = selected;
    let running = false;
    const confirmation = Modal.confirm({
      title: "恢复此版本？",
      content:
        "请先让所有协作者关闭该文档编辑窗口并等待保存完成。恢复会替换当前正文和标题，当前内容会自动保留为备份版本。",
      okText: "确认恢复",
      cancelText: "取消",
      /** 手动关闭成功的确认框；业务冲突保留框体以供重试，不抛出未处理拒绝。 */
      onOk(close: () => void) {
        if (running) return;
        running = true;
        confirmation.update({
          okButtonProps: { loading: true },
          cancelButtonProps: { disabled: true },
        });
        void restore.mutateAsync(versionId).then(
          () => close(),
          () => {
            running = false;
            confirmation.update({
              okButtonProps: { loading: false },
              cancelButtonProps: { disabled: false },
            });
          },
        );
      },
    });
  }
  return (
    <div className="grid gap-4">
      <Alert
        type="info"
        showIcon
        message="自动保存保留历史；预览显示文档/表格纯文本。恢复前请关闭所有编辑窗口。"
      />
      {editable && (
        <div className="flex gap-2">
          <Input
            aria-label="版本名称"
            value={label}
            maxLength={120}
            placeholder="版本名称（可选）"
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button
            icon={<Save size={15} />}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            保存当前版本
          </Button>
        </div>
      )}
      {versions.isError ? (
        <Alert
          type="error"
          message={versions.error.message}
          action={<Button onClick={() => void versions.refetch()}>重试</Button>}
        />
      ) : (
        <div className="grid min-h-[280px] grid-cols-[240px_minmax(0,1fr)] gap-4 max-sm:grid-cols-1">
          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-[var(--app-line)] p-2">
            {versions.isLoading && <Skeleton active />}
            {versions.data?.map((version) => (
              <button
                key={version.id}
                type="button"
                onClick={() => setSelected(version.id)}
                className={`mb-1 block w-full rounded-lg p-3 text-left ${selected === version.id ? "bg-[var(--app-primary-soft)]" : "hover:bg-[var(--app-surface-soft)]"}`}
              >
                <strong className="block text-sm">
                  {version.label} <Tag bordered={false}>#{version.id}</Tag>
                </strong>
                <span className="mt-1 block text-xs text-[var(--app-text-secondary)]">
                  {version.author.name} ·{" "}
                  {new Date(version.createdAt).toLocaleString("zh-CN")}
                </span>
              </button>
            ))}
            {!versions.isLoading && !versions.data?.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无版本，保存当前版本开始记录"
              />
            )}
          </div>
          <section className="flex min-w-0 flex-col rounded-lg border border-[var(--app-line)] p-4">
            {!selected ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="选择版本查看内容"
              />
            ) : preview.isLoading ? (
              <Skeleton active />
            ) : preview.isError ? (
              <Alert type="error" message={preview.error.message} />
            ) : (
              <>
                <strong>{preview.data?.title}</strong>
                <pre className="mt-3 max-h-[330px] flex-1 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-[var(--app-text-secondary)]">
                  {preview.data?.text || "（空白文档）"}
                </pre>
                {editable && (
                  <Button
                    type="primary"
                    loading={restore.isPending}
                    disabled={!preview.data}
                    onClick={confirmRestore}
                  >
                    恢复此版本
                  </Button>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
