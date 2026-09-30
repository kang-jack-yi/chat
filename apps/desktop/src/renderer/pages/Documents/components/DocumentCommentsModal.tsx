import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Button, Empty, Input, Modal, Segmented, Tag, message } from "antd";
import { CheckCircle2, MessageSquare, Send } from "lucide-react";
import type { CloudDocument, DocumentComment } from "@chat/shared";
import { queryKeys } from "../../../constants/query-keys";
import { documentsService } from "../../../services/documents";
import { buildCommentThreads, type CommentThreadFilter } from "./comment-threads";

interface DocumentCommentsModalProps {
  document: CloudDocument | null;
  onClose: () => void;
}

/** 展示文档评论弹窗，按文档隔离草稿、回复目标及异步请求状态。 */
export default function DocumentCommentsModal({
  document,
  onClose,
}: DocumentCommentsModalProps) {
  return (
    <Modal
      open={Boolean(document)}
      title={
        <span className="flex items-center gap-2">
          <MessageSquare size={18} />
          {document?.title} · 评论
        </span>
      }
      footer={null}
      onCancel={onClose}
      destroyOnHidden
      width={560}
    >
      {document && <DocumentCommentsContent key={document.id} document={document} />}
    </Modal>
  );
}

/** 展示根评论线程并处理当前文档的回复、筛选和解决操作。 */
function DocumentCommentsContent({ document }: { document: CloudDocument }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [replyId, setReplyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<CommentThreadFilter>("all");
  const comments = useQuery({
    queryKey: queryKeys.documentComments(document.id),
    queryFn: () => documentsService.comments(document.id),
  });
  const threads = buildCommentThreads(comments.data ?? []);
  const visibleThreads = threads.filter(({ root }) =>
    filter === "all" || root.resolved === (filter === "resolved"),
  );
  const replyThread = threads.find(({ root }) => root.id === replyId);
  const replyBlocked = replyId !== null && (!replyThread || replyThread.root.resolved);
  const create = useMutation({
    mutationFn: (payload: { content: string; parentId: number | null }) =>
      documentsService.createComment(document.id, { ...payload, content: payload.content.trim() }),
    onSuccess: async (_, payload) => {
      setContent((draft) => draft === payload.content ? "" : draft);
      setReplyId((current) => current === payload.parentId ? null : current);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.documentComments(document.id),
      });
      message.success("评论已发布");
    },
    onError: (error: Error) => message.error(error.message),
  });
  const resolve = useMutation({
    mutationFn: ({
      commentId,
      resolved,
    }: {
      commentId: number;
      resolved: boolean;
    }) => documentsService.updateComment(document.id, commentId, resolved),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: queryKeys.documentComments(document.id),
      }),
    onError: (error: Error) => message.error(error.message),
  });

  /** 仅向仍未解决的根线程发布回复，避免已解决线程或空内容被提交。 */
  function submitComment() {
    if (!content.trim() || create.isPending) return;
    if (replyBlocked) {
      message.warning(replyThread ? "该线程已解决，请先重新打开后回复" : "该线程已不存在，请取消回复");
      return;
    }
    create.mutate({ content, parentId: replyId });
  }

  return (
    <div className="grid gap-3">
      <Segmented<CommentThreadFilter>
        size="small"
        value={filter}
        options={[
          { label: "全部", value: "all" },
          { label: "未解决", value: "unresolved" },
          { label: "已解决", value: "resolved" },
        ]}
        onChange={setFilter}
      />
      <div className="max-h-[420px] overflow-y-auto pr-1">
        {visibleThreads.map(({ root, replies }) => (
          <article
            key={root.id}
            className={`mb-3 rounded-lg border p-3 ${root.resolved ? "border-[var(--app-line)] bg-[var(--app-surface-soft)]" : "border-[var(--app-primary)]/25 bg-[var(--app-surface)]"}`}
          >
            <CommentItem comment={root} resolved={root.resolved} />
            {replies.length > 0 && (
              <div className="ml-9 mt-2 grid gap-2 border-l border-[var(--app-line)] pl-3">
                {replies.map((reply) => <CommentItem key={reply.id} comment={reply} />)}
              </div>
            )}
            <div className="mt-2 flex items-center justify-end gap-1">
              {root.resolved && (
                <span className="mr-auto text-xs text-[var(--app-text-tertiary)]">
                  已解决，请先重新打开后回复
                </span>
              )}
              <Button
                type="text"
                size="small"
                disabled={root.resolved || create.isPending || resolve.isPending}
                onClick={() => setReplyId(root.id)}
              >
                回复
              </Button>
              <Button
                type="text"
                size="small"
                loading={resolve.isPending}
                icon={<CheckCircle2 size={15} />}
                onClick={() => resolve.mutate({ commentId: root.id, resolved: !root.resolved })}
              >
                {root.resolved ? "重新打开" : "解决"}
              </Button>
            </div>
          </article>
        ))}
        {!comments.isLoading && !visibleThreads.length && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={filter === "all" ? "还没有评论" : filter === "resolved" ? "没有已解决的评论" : "没有未解决的评论"}
          />
        )}
      </div>
      <div className="border-t border-[var(--app-line)] pt-3">
        <Input.TextArea
          value={content}
          maxLength={2000}
          showCount
          rows={3}
          disabled={create.isPending}
          placeholder={replyId === null ? "写下你的评论" : "写下你的回复"}
          onChange={(event) => setContent(event.target.value)}
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {replyId !== null && (
            <>
              <span className="mr-auto min-w-0 truncate text-xs text-[var(--app-text-secondary)]">
                {replyBlocked
                  ? replyThread ? "该线程已解决，请先重新打开后回复" : "该线程已不存在，请取消回复"
                  : `回复 ${replyThread?.root.author.name}`}
              </span>
              <Button size="small" disabled={create.isPending} onClick={() => setReplyId(null)}>
                取消回复
              </Button>
            </>
          )}
          <Button
            type="primary"
            icon={<Send size={15} />}
            loading={create.isPending}
            disabled={!content.trim() || replyBlocked || resolve.isPending}
            onClick={submitComment}
          >
            {replyId === null ? "发布评论" : "发布回复"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 展示单条评论的作者、发布时间和正文；线程状态仅由根评论标记。 */
function CommentItem({
  comment,
  resolved = false,
}: {
  comment: DocumentComment;
  resolved?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Avatar size={28}>
        {comment.author.avatar || comment.author.name.slice(0, 1)}
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-xs text-[var(--app-text)]">
            {comment.author.name}
          </strong>
          <time dateTime={comment.createdAt} className="text-xs text-[var(--app-text-tertiary)]">
            {new Date(comment.createdAt).toLocaleString("zh-CN", { hour12: false })}
          </time>
          {comment.anchor && <Tag bordered={false}>{comment.anchor}</Tag>}
          {resolved && <Tag color="success">已解决</Tag>}
        </div>
        <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--app-text-secondary)]">
          {comment.content}
        </p>
      </div>
    </div>
  );
}
