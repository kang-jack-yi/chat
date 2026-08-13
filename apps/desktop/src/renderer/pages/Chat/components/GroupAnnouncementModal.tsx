import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, message as toast } from "antd";
import { Megaphone } from "lucide-react";
import type {
  Conversation,
  Message,
  OutgoingMessagePart,
  User,
} from "@chat/shared";
import { chatService } from "../../../services/chat";
import { uploadService } from "../../../services/upload";
import {
  composerContentParts,
  richTextToPlainText,
} from "../../../utils/rich-text";
import type { DraftAttachmentItem } from "../../../stores/chat-draft-store";
import MessageContent from "./MessageContent";
import RichTextEditor, { type DraftFileSource } from "./RichTextEditor";

export interface GroupAnnouncementModalProps {
  open: boolean;
  conversation: Conversation;
  currentUser: User;
  onClose: () => void;
  onPublished: (message: Message) => void | Promise<void>;
}

function imageDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || 1,
        height: image.naturalHeight || 1,
      });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({ width: 1, height: 1 });
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

function imagePreview(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("图片预览读取失败"));
    reader.readAsDataURL(file);
  });
}

export default function GroupAnnouncementModal({
  open,
  conversation,
  currentUser,
  onClose,
  onPublished,
}: GroupAnnouncementModalProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachmentItem[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const isOwner = conversation.createdBy === currentUser.id;
  const canPublish = Boolean(
    richTextToPlainText(draft).trim() || attachments.length,
  );

  async function removeAttachment(id: string) {
    const target = attachments.find((item) => item.meta.id === id);
    setAttachments((items) => items.filter((item) => item.meta.id !== id));
    if (target?.meta.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(target.meta.previewUrl);
    }
    await window.desktop?.attachment.removeDraft(id);
  }

  async function clearDraft() {
    const items = attachments;
    setDraft("");
    setAttachments([]);
    await Promise.all(items.map(async (item) => {
      if (item.meta.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(item.meta.previewUrl);
      }
      await window.desktop?.attachment.removeDraft(item.meta.id);
    }));
  }

  useEffect(() => {
    if (open) {
      setError("");
      return;
    }
    setDraft("");
    setAttachments([]);
  }, [conversation.id, open]);

  async function addImages(files: File[], _source: DraftFileSource) {
    if (!window.desktop || !files.length) return;
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length !== files.length) {
      toast.warning("群公告仅支持添加图片附件");
    }
    const accepted = images.filter((file) => {
      if (file.size <= 10 * 1024 * 1024) return true;
      toast.warning(`${file.name} 超过 10 MB，未添加`);
      return false;
    });
    const staged: DraftAttachmentItem[] = [];
    for (const file of accepted) {
      const meta = await window.desktop.attachment.stage({
        name: file.name || `公告图片-${Date.now()}.png`,
        mimeType: file.type || "image/png",
        size: file.size,
        data: new Uint8Array(await file.arrayBuffer()),
      });
      Object.assign(meta, await imageDimensions(file));
      meta.previewUrl = await imagePreview(file);
      staged.push({ meta, file });
    }
    setAttachments((items) => [...items, ...staged]);
  }

  async function publish() {
    if (!isOwner || publishing || !canPublish) return;
    const plainText = richTextToPlainText(draft);
    if (plainText.length > 20_000) {
      setError("群公告文字不能超过 20000 个字符");
      return;
    }
    setPublishing(true);
    setError("");
    const uploadedIds: number[] = [];
    try {
      const attachmentMap = new Map(
        attachments.map((item) => [item.meta.id, item]),
      );
      const parts: OutgoingMessagePart[] = [];
      for (const part of composerContentParts(draft)) {
        if (part.type === "text") {
          parts.push({ type: "text", text: part.text });
          continue;
        }
        if (part.type === "mention") {
          parts.push({
            type: "mention",
            userId: part.userId,
            label: part.label,
          });
          continue;
        }
        if (part.type === "mention_all") {
          parts.push({ type: "mention_all", label: "所有人" });
          continue;
        }
        const item = attachmentMap.get(part.id);
        if (!item?.meta.image) continue;
        const attachment = await uploadService.file(item.file);
        uploadedIds.push(attachment.id);
        parts.push({
          type: "image",
          attachmentId: attachment.id,
          width: item.meta.width || 1,
          height: item.meta.height || 1,
        });
      }
      const message = await chatService.publishAnnouncement({
        conversationId: conversation.id,
        clientId: crypto.randomUUID(),
        schemaVersion: 1,
        parts,
      });
      await clearDraft();
      await onPublished(message);
    } catch (reason) {
      await Promise.all(
        uploadedIds.map((id) => uploadService.remove(id).catch(() => undefined)),
      );
      setError(reason instanceof Error ? reason.message : "群公告发布失败");
    } finally {
      setPublishing(false);
    }
  }

  async function close() {
    if (publishing) return;
    await clearDraft();
    onClose();
  }

  return (
    <Modal
      open={open}
      title="群公告"
      width={620}
      centered
      styles={{
        wrapper: {
          overflow: "hidden",
        },
        container: {
          display: "flex",
          maxHeight: "calc(100vh - 32px)",
          flexDirection: "column",
          overflow: "hidden",
        },
        header: {
          flex: "0 0 auto",
        },
        body: {
          minHeight: 0,
          flex: 1,
          overflowY: "auto",
        },
      }}
      footer={null}
      onCancel={() => void close()}
      destroyOnHidden
    >
      <div className="pb-2">
        <div className="mb-3 flex items-center gap-2 text-xs text-[#8a94a3]">
          <Megaphone size={15} />
          {isOwner
            ? "公告将作为一条独立消息发送给所有群成员"
            : "仅群主可以发布群公告"}
        </div>

        {error && (
          <Alert
            className="mb-3"
            type="error"
            message={error}
            closable
            onClose={() => setError("")}
          />
        )}

        {conversation.announcementMessage && (
          <div className="mb-3 rounded-xl border border-[var(--app-line)] bg-[var(--app-surface-soft)] p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--app-text-secondary)]">
              <Megaphone size={14} className="text-[var(--app-primary)]" />
              当前群公告
            </div>
            <MessageContent
              message={conversation.announcementMessage}
              contextMenuEnabled={false}
            />
          </div>
        )}

        {isOwner && (
          <>
            <input
              ref={imageInputRef}
              hidden
              multiple
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                void addImages(files, "picker");
              }}
            />
            <div className="rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] px-3 py-2 focus-within:border-[var(--app-primary)] focus-within:shadow-[0_0_0_2px_rgba(115,167,247,.12)]">
              <RichTextEditor
                value={draft}
                attachments={attachments}
                onChange={setDraft}
                onSubmit={() => void publish()}
                onPickImage={() => imageInputRef.current?.click()}
                onPasteFiles={(files, source) => void addImages(files, source)}
                onRemoveAttachment={(id) => void removeAttachment(id)}
                disabled={publishing}
                mentionsEnabled
                mentionUsers={(conversation.members ?? []).filter(
                  (member) => member.status === "active",
                )}
                showFilePicker={false}
                placeholder="输入群公告，支持文字、表情、@成员和图片"
                editorClassName="min-h-[150px] max-h-[260px]"
              />
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => void close()} disabled={publishing}>
            {isOwner ? "取消" : "关闭"}
          </Button>
          {isOwner && (
            <Button
              type="primary"
              loading={publishing}
              disabled={!canPublish}
              onClick={() => void publish()}
            >
              发布公告
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
