import { Alert, Spin } from "antd";
import { useEffect, useState } from "react";
import type {
  Attachment,
  ForwardRecordTask,
  ImagePart,
  Message,
} from "@chat/shared";
import MessageView from "../../renderer/pages/Chat/components/MessageView";

export interface ForwardRecordWindowProps {
  task: ForwardRecordTask;
}

export default function ForwardRecordWindow({ task }: ForwardRecordWindowProps) {
  const [message, setMessage] = useState<Message | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setMessage(null);
    setError("");
    window.auxiliary?.forwardRecord.get(task.taskId)
      .then((result) => {
        if (active) setMessage(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "聊天记录加载失败");
      });
    return () => {
      active = false;
    };
  }, [task.taskId]);

  const record = message?.parts.find((part) => part.type === "chat_record");

  useEffect(() => {
    document.title = record?.type === "chat_record" ? record.title : "聊天记录";
  }, [record]);

  async function resolveAttachment(attachment: Attachment) {
    const result = await window.auxiliary!.attachments.resolve({
      taskId: task.taskId,
      attachmentId: attachment.id,
    });
    return result.url;
  }

  function previewImage(item: Message, part: ImagePart) {
    void window.auxiliary?.images.openViewer({
      taskId: task.taskId,
      conversationId: task.conversationId,
      messageId: message?.id || item.id,
      attachmentId: part.attachment.id,
    });
  }

  if (error) {
    return (
      <div className="grid h-screen place-items-center bg-[var(--app-canvas)] p-6">
        <Alert type="error" showIcon message="聊天记录加载失败" description={error} />
      </div>
    );
  }
  if (!message || record?.type !== "chat_record") {
    return (
      <div className="grid h-screen place-items-center bg-[var(--app-canvas)]">
        <Spin />
      </div>
    );
  }

  return (
    <div data-chat-root className="h-screen bg-[var(--chat-canvas)]">
      <main className="h-full overflow-y-auto px-5 py-4">
        {record.items.map((snapshot, index) => {
          const item: Message = {
            schemaVersion: 1,
            id: message.id,
            clientId: `${message.clientId}:snapshot:${index}`,
            conversationId: message.conversationId,
            senderId: snapshot.senderId,
            senderName: snapshot.senderName,
            senderAvatar: snapshot.senderAvatar,
            kind: "user",
            parts: snapshot.parts,
            summary: snapshot.summary,
            version: 1,
            createdAt: snapshot.createdAt,
            updatedAt: snapshot.createdAt,
            deletedAt: null,
          };
          return (
            <article key={`${snapshot.originalMessageId}:${index}`} className="border-b border-[var(--chat-line)] py-3 last:border-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <strong className="truncate text-sm font-medium text-[var(--chat-text)]">
                  {snapshot.senderName}
                </strong>
                <time className="shrink-0 text-[11px] text-[var(--chat-text-tertiary)]">
                  {new Date(snapshot.createdAt).toLocaleString("zh-CN", { hour12: false })}
                </time>
              </div>
              <div className="text-sm text-[var(--chat-text)]">
                <MessageView
                  message={item}
                  contextMenuEnabled={false}
                  resolveAttachmentUrl={resolveAttachment}
                  onPreviewImage={previewImage}
                />
              </div>
            </article>
          );
        })}
      </main>
    </div>
  );
}
