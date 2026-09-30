import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Button, Empty, Input, Modal, Tag, message } from "antd";
import { CheckCircle2, MessageSquare, Send } from "lucide-react";
import type { CloudDocument, DocumentComment } from "@chat/shared";
import { queryKeys } from "../../../constants/query-keys";
import { documentsService } from "../../../services/documents";

interface DocumentCommentsModalProps {
  document: CloudDocument | null;
  onClose: () => void;
}

export default function DocumentCommentsModal({ document, onClose }: DocumentCommentsModalProps) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const comments = useQuery({
    queryKey: queryKeys.documentComments(document?.id),
    queryFn: () => documentsService.comments(document!.id),
    enabled: Boolean(document),
  });
  const create = useMutation({
    mutationFn: () => documentsService.createComment(document!.id, { content: content.trim() }),
    onSuccess: async () => {
      setContent("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.documentComments(document?.id) });
      message.success("评论已发布");
    },
    onError: (error: Error) => message.error(error.message),
  });
  const resolve = useMutation({
    mutationFn: ({ commentId, resolved }: { commentId: number; resolved: boolean }) =>
      documentsService.updateComment(document!.id, commentId, resolved),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.documentComments(document?.id) }),
    onError: (error: Error) => message.error(error.message),
  });

  return (
    <Modal
      open={Boolean(document)}
      title={<span className="flex items-center gap-2"><MessageSquare size={18} />{document?.title} · 评论</span>}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
      width={560}
    >
      <div className="grid gap-3">
        <div className="max-h-[420px] overflow-y-auto pr-1">
          {comments.data?.map((comment) => (
            <CommentItem key={comment.id} comment={comment} loading={resolve.isPending} onResolve={(resolved) => resolve.mutate({ commentId: comment.id, resolved })} />
          ))}
          {!comments.isLoading && !comments.data?.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有评论" />}
        </div>
        <div className="border-t border-[var(--app-line)] pt-3">
          <Input.TextArea
            value={content}
            maxLength={2000}
            showCount
            rows={3}
            placeholder="写下你的评论"
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button type="primary" icon={<Send size={15} />} loading={create.isPending} disabled={!content.trim()} onClick={() => create.mutate()}>
              发布评论
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CommentItem({ comment, loading, onResolve }: { comment: DocumentComment; loading: boolean; onResolve: (resolved: boolean) => void }) {
  return (
    <article className={`mb-3 rounded-lg border p-3 ${comment.resolved ? "border-[var(--app-line)] bg-[var(--app-surface-soft)]" : "border-[var(--app-primary)]/25 bg-[var(--app-surface)]"}`}>
      <div className="flex items-start gap-2">
        <Avatar size={28}>{comment.author.avatar || comment.author.name.slice(0, 1)}</Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <strong className="text-xs text-[var(--app-text)]">{comment.author.name}</strong>
            {comment.anchor && <Tag bordered={false}>{comment.anchor}</Tag>}
            {comment.resolved && <Tag color="success">已解决</Tag>}
          </div>
          <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--app-text-secondary)]">{comment.content}</p>
        </div>
        <Button
          type="text"
          size="small"
          loading={loading}
          icon={<CheckCircle2 size={15} />}
          onClick={() => onResolve(!comment.resolved)}
        >
          {comment.resolved ? "重新打开" : "解决"}
        </Button>
      </div>
    </article>
  );
}
