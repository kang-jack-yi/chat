import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { message as toast } from "antd";
import type {
  Attachment,
  Conversation,
  LocalMessage,
  Message,
  MessageRecalledEvent,
  MessagesRemovedForMeEvent,
  MessagePart,
  OutgoingMessagePart,
  SendMessagePayload,
  User,
} from "@chat/shared";
import { queryKeys } from "../../constants/query-keys";
import { chatService } from "../../services/chat";
import { uploadService } from "../../services/upload";
import { useSocket } from "../../hooks/useSocket";
import type { MessagePage } from "../../types/api";
import {
  composerContentParts,
  richTextToPlainText,
} from "../../utils/rich-text";
import { localDatabase } from "../../services/local-database";
import { syncService } from "../../services/sync";
import {
  emptyConversationDraft,
  useChatDraftStore,
  type ConversationDraft,
  type DraftAttachmentItem,
} from "../../stores/chat-draft-store";
import { clearConversationUnread } from "./conversation-read";

export type { DraftAttachmentItem } from "../../stores/chat-draft-store";

type DraftFileSource = "clipboard" | "drop" | "picker" | "screenshot";

type ImageMessageContent =
  | { type: "text"; text: string }
  | { type: "mention"; userId: number; label: string }
  | { type: "mention_all"; label: "所有人" }
  | { type: "image"; item: DraftAttachmentItem };

export function useConversations() {
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: chatService.conversations,
  });
}

function imageSize(file: File) {
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

function inferredMimeType(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
    }[extension || ""] || "application/octet-stream"
  );
}

function normalizedDraftFile(
  file: File,
  source: DraftFileSource,
  index: number,
) {
  const mimeType = inferredMimeType(file);
  const basename = file.name.replace(/\.[^.]+$/, "");
  const clipboardTemporaryName =
    !file.name ||
    /^image(\.[a-z0-9]+)?$/i.test(file.name) ||
    /^[a-f0-9-]{12,}$/i.test(basename);
  if (
    source !== "clipboard" ||
    !mimeType.startsWith("image/") ||
    !clipboardTemporaryName
  ) {
    return file.type === mimeType
      ? file
      : new File([file], file.name || `文件-${Date.now()}-${index + 1}`, {
          type: mimeType,
        });
  }
  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return new File(
    [file],
    `剪贴板图片-${Date.now()}-${index + 1}.${extension}`,
    { type: mimeType },
  );
}

function imagePreview(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () =>
      reject(reader.error || new Error("图片预览读取失败"));
    reader.readAsDataURL(file);
  });
}

function releasePreview(url: string) {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function useChat(
  conversationId: number | undefined,
  currentUser: User,
  focusedMessageId?: number,
) {
  const socket = useSocket();
  const queryClient = useQueryClient();
  const drafts = useChatDraftStore((state) => state.drafts);
  const updateDraft = useChatDraftStore((state) => state.updateDraft);
  const [typingName, setTypingName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const messageListRef = useRef<HTMLElement>(null);
  const typingTimer = useRef<number | null>(null);
  const lastReportedRead = useRef(0);
  const appliedReadReceipts = useRef(new Set<string>());
  const initialScrollPendingConversation = useRef<number | undefined>(
    undefined,
  );
  const initialScrollStartedConversation = useRef<number | undefined>(
    undefined,
  );
  const initialScrollFrame = useRef<number | undefined>(undefined);
  const initialScrollObserver = useRef<ResizeObserver | undefined>(undefined);
  const initialScrollTimeout = useRef<number | undefined>(undefined);
  const sendScrollFrame = useRef<number | undefined>(undefined);
  const messageContentRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const activeUploads = useRef(
    new Map<
      string,
      {
        controller: AbortController;
        uploadedIds: number[];
        draftIds: string[];
      }
    >(),
  );
  const uploadRetries = useRef(new Map<string, () => Promise<boolean>>());

  const draftState = conversationId
    ? drafts[conversationId] || emptyConversationDraft()
    : emptyConversationDraft();
  const messages = useInfiniteQuery({
    queryKey: queryKeys.messages(conversationId),
    queryFn: ({ pageParam }) =>
      chatService.messages(conversationId!, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(conversationId),
  });
  const latestMessageItems = useMemo(
    () =>
      messages.data?.pages
        .slice()
        .reverse()
        .flatMap((page) => page.items) ?? [],
    [messages.data?.pages],
  );
  const messageContext = useQuery({
    queryKey: queryKeys.messageContext(conversationId, focusedMessageId),
    queryFn: () =>
      localDatabase.messageContext(conversationId!, focusedMessageId!),
    enabled: Boolean(conversationId && focusedMessageId),
  });
  const messageItems = focusedMessageId
    ? (messageContext.data?.items ?? [])
    : latestMessageItems;

  function setConversationDraft(
    updater: (draft: ConversationDraft) => ConversationDraft,
  ) {
    if (!conversationId) return;
    updateDraft(conversationId, updater);
  }

  function updateMessages(updater: (items: Message[]) => Message[]) {
    if (!conversationId) return;
    queryClient.setQueryData<InfiniteData<MessagePage<Message>>>(
      queryKeys.messages(conversationId),
      (old) => {
        if (!old) {
          return {
            pages: [{ items: updater([]), nextCursor: null }],
            pageParams: [undefined],
          };
        }
        const pages = [...old.pages];
        pages[0] = { ...pages[0], items: updater(pages[0].items) };
        return { ...old, pages };
      },
    );
  }

  function scrollToLatestAfterSend() {
    if (sendScrollFrame.current !== undefined) {
      window.cancelAnimationFrame(sendScrollFrame.current);
    }
    sendScrollFrame.current = window.requestAnimationFrame(() => {
      const container = messageListRef.current;
      if (container) container.scrollTop = container.scrollHeight;
      sendScrollFrame.current = window.requestAnimationFrame(() => {
        const latestContainer = messageListRef.current;
        if (latestContainer)
          latestContainer.scrollTop = latestContainer.scrollHeight;
        sendScrollFrame.current = undefined;
      });
    });
  }

  function cancelInitialScroll() {
    if (initialScrollFrame.current !== undefined) {
      window.cancelAnimationFrame(initialScrollFrame.current);
      initialScrollFrame.current = undefined;
    }
    initialScrollObserver.current?.disconnect();
    initialScrollObserver.current = undefined;
    if (initialScrollTimeout.current !== undefined) {
      window.clearTimeout(initialScrollTimeout.current);
      initialScrollTimeout.current = undefined;
    }
    initialScrollPendingConversation.current = undefined;
  }

  function patchMessage(clientId: string, patch: Partial<LocalMessage>) {
    updateMessages((items) =>
      items.map((item) =>
        item.clientId === clientId ? ({ ...item, ...patch } as Message) : item,
      ),
    );
  }

  function applyRecall(event: MessageRecalledEvent) {
    if (event.conversationId !== conversationId) return;
    setConversationDraft((draft) =>
      draft.quote?.id === event.recalledMessageId
        ? { ...draft, quote: undefined }
        : draft,
    );
    updateMessages((items) => [
      ...items.filter(
        (item) =>
          item.id !== event.recalledMessageId &&
          item.clientId !== event.systemMessage.clientId,
      ),
      event.systemMessage,
    ]);
    if (localDatabase.available()) {
      void localDatabase.upsertMessages([event.systemMessage]);
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
  }

  useEffect(() => {
    lastReportedRead.current = 0;
    appliedReadReceipts.current.clear();
  }, [conversationId]);

  useLayoutEffect(() => {
    cancelInitialScroll();
    if (!conversationId || focusedMessageId) return;
    initialScrollPendingConversation.current = conversationId;
    initialScrollStartedConversation.current = undefined;
  }, [conversationId, focusedMessageId]);

  useLayoutEffect(() => {
    if (
      !conversationId ||
      focusedMessageId ||
      !messageItems.length ||
      initialScrollPendingConversation.current !== conversationId ||
      initialScrollStartedConversation.current === conversationId
    )
      return;
    // Wait for the selected conversation's first message batch to render. Keep
    // the viewport pinned while its initial images finish decoding, but only
    // until the user starts browsing the history.
    initialScrollStartedConversation.current = conversationId;
    const pinToLatest = () => {
      const container = messageListRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    };
    initialScrollFrame.current = window.requestAnimationFrame(() => {
      pinToLatest();
      initialScrollFrame.current = window.requestAnimationFrame(() => {
        pinToLatest();
        initialScrollFrame.current = undefined;
      });
    });
    const content = messageContentRef.current;
    if (content) {
      initialScrollObserver.current = new ResizeObserver(pinToLatest);
      initialScrollObserver.current.observe(content);
    }
    initialScrollTimeout.current = window.setTimeout(() => {
      initialScrollObserver.current?.disconnect();
      initialScrollObserver.current = undefined;
      initialScrollTimeout.current = undefined;
      initialScrollPendingConversation.current = undefined;
    }, 4000);
  }, [conversationId, focusedMessageId, messageItems.length]);

  useEffect(() => {
    if (!conversationId) return;
    let openedConversation: Conversation | undefined;
    queryClient.setQueryData<Conversation[]>(
      queryKeys.conversations,
      (current) => {
        openedConversation = current?.find(
          (item) => item.id === conversationId,
        );
        return clearConversationUnread(current, conversationId);
      },
    );
    if (openedConversation && localDatabase.available()) {
      void localDatabase.upsertConversations([
        {
          ...openedConversation,
          unreadCount: 0,
          mentioned: false,
          mentionMessageId: null,
          mentionType: null,
        },
      ]);
    }
  }, [conversationId, queryClient]);

  useEffect(() => {
    if (!socket || !conversationId) return;
    /** 保留实时消息；若历史快照仍在加载，取消旧查询并重取完整历史。 */
    const onMessage = async (message: Message) => {
      if (message.conversationId !== conversationId) return;
      if (localDatabase.available())
        await localDatabase.upsertMessages([message]);
      const queryKey = queryKeys.messages(conversationId);
      const historyPending =
        queryClient.getQueryState(queryKey)?.fetchStatus === "fetching";
      if (historyPending) {
        await queryClient.cancelQueries(
          { queryKey, exact: true },
          { revert: false },
        );
      }
      updateMessages((items) => [
        ...items.filter((item) => item.clientId !== message.clientId),
        message,
      ]);
      if (historyPending)
        void queryClient.invalidateQueries({ queryKey, exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      if (message.senderId !== currentUser.id)
        void chatService.read(conversationId, message.id);
    };
    const onSyncAvailable = async () => {
      if (!localDatabase.available()) return;
      await syncService.incremental();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.messages(conversationId),
      });
    };
    const onTyping = (payload: {
      conversationId: number;
      name: string;
      typing: boolean;
    }) => {
      if (payload.conversationId === conversationId)
        setTypingName(payload.typing ? payload.name : "");
    };
    const onRead = (payload: {
      conversationId: number;
      userId: number;
      previousMessageId?: number;
      messageId: number;
    }) => {
      if (payload.conversationId === conversationId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.messageReceiptsForConversation(conversationId),
        });
        const receiptKey = `${payload.userId}:${payload.messageId}`;
        if (appliedReadReceipts.current.has(receiptKey)) return;
        appliedReadReceipts.current.add(receiptKey);
        let changed: Message[] = [];
        updateMessages((items) =>
          items.map((item) => {
            if (
              item.senderId !== currentUser.id ||
              payload.userId === currentUser.id ||
              item.id <= Number(payload.previousMessageId || 0) ||
              item.id > payload.messageId ||
              !item.recipientCount
            ) {
              return item;
            }
            const updated = {
              ...item,
              readCount: Math.min(
                item.recipientCount,
                Number(item.readCount || 0) + 1,
              ),
            };
            changed.push(updated);
            return updated;
          }),
        );
        if (changed.length && localDatabase.available()) {
          void localDatabase.upsertMessages(changed);
        }
      }
    };
    const onRecall = (event: MessageRecalledEvent) => {
      applyRecall(event);
    };
    const onRemovedForMe = (event: MessagesRemovedForMeEvent) => {
      if (event.conversationId !== conversationId) return;
      const removed = new Set(event.deletedMessageIds);
      updateMessages((items) => items.filter((item) => !removed.has(item.id)));
      void localDatabase.removeMessagesForMe(
        event.conversationId,
        event.deletedMessageIds,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    };
    socket.on("message:new", onMessage);
    socket.on("message:recalled", onRecall);
    socket.on("message:removed-for-me", onRemovedForMe);
    socket.on("typing:changed", onTyping);
    socket.on("message:read", onRead);
    socket.on("sync:available", onSyncAvailable);
    return () => {
      socket.off("message:new", onMessage);
      socket.off("message:recalled", onRecall);
      socket.off("message:removed-for-me", onRemovedForMe);
      socket.off("typing:changed", onTyping);
      socket.off("message:read", onRead);
      socket.off("sync:available", onSyncAvailable);
    };
  }, [conversationId, currentUser.id, queryClient, socket]);

  useEffect(() => {
    if (focusedMessageId) return;
    const lastMessage = messageItems
      .slice()
      .reverse()
      .find((message) => message.id > 0);
    if (
      conversationId &&
      lastMessage &&
      lastMessage.id > lastReportedRead.current
    ) {
      lastReportedRead.current = lastMessage.id;
      void chatService.read(conversationId, lastMessage.id).catch(() => {
        lastReportedRead.current = 0;
      });
    }
  }, [conversationId, currentUser.id, focusedMessageId, messageItems]);

  function localMessage(
    clientId: string,
    parts: MessagePart[],
    summary: string,
    status: LocalMessage["status"],
  ): LocalMessage {
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      id: -Date.now() - Math.floor(Math.random() * 1_000),
      localId: `local:${clientId}`,
      serverId: null,
      clientId,
      conversationId: conversationId!,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar,
      kind: "user",
      parts,
      summary,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      status,
      progress: status === "uploading" ? 0 : undefined,
      readCount: 0,
      recipientCount: 0,
    };
  }

  async function deliver(pending: LocalMessage, command: SendMessagePayload) {
    await localDatabase.enqueue(pending, command);
    patchMessage(pending.clientId, { status: "sending", progress: 100 });
    await localDatabase.markMessage({
      clientId: pending.clientId,
      status: "sending",
    });
    try {
      const saved = await chatService.send(command);
      await localDatabase.markMessage({
        clientId: pending.clientId,
        message: saved,
        status: "sent",
      });
      updateMessages((items) => [
        ...items.filter((item) => item.clientId !== pending.clientId),
        saved,
      ]);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送失败";
      await localDatabase.markMessage({
        clientId: pending.clientId,
        status: "failed",
        error: message,
      });
      patchMessage(pending.clientId, {
        status: "failed",
        error: { code: "SEND_FAILED", message, retryable: true },
      });
    }
  }

  async function uploadItem(
    item: DraftAttachmentItem,
    onProgress: (progress: number) => void,
    signal?: AbortSignal,
  ) {
    return uploadService.file(item.file, onProgress, signal);
  }

  async function cleanDraftItems(items: DraftAttachmentItem[]) {
    for (const item of items) {
      releasePreview(item.meta.previewUrl);
      await window.desktop?.attachment.removeDraft(item.meta.id);
    }
  }

  async function sendImageMessage(
    content: ImageMessageContent[],
    quote?: Message,
    retryClientId?: string,
  ) {
    const clientId = retryClientId || crypto.randomUUID();
    const images = content
      .filter(
        (part): part is Extract<ImageMessageContent, { type: "image" }> =>
          part.type === "image",
      )
      .map((part) => part.item);
    let previewImageIndex = 0;
    const previewParts: MessagePart[] = [
      ...(quote
        ? [
            {
              type: "quote" as const,
              messageId: quote.id,
              senderId: quote.senderId,
              senderName: quote.senderName,
              summary: quote.summary,
            },
          ]
        : []),
      ...content.map((part): MessagePart => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "mention") {
          return { type: "mention", userId: part.userId, label: part.label };
        }
        if (part.type === "mention_all") {
          return { type: "mention_all", label: "所有人" };
        }
        previewImageIndex += 1;
        return {
          type: "image",
          attachment: {
            id: -previewImageIndex,
            draftId: part.item.meta.id,
            originalName: part.item.meta.name,
            mimeType: part.item.meta.mimeType,
            size: part.item.meta.size,
            url: part.item.meta.previewUrl,
          },
          width: part.item.meta.width || 1,
          height: part.item.meta.height || 1,
        };
      }),
    ];
    const initialStatus = images.length ? "uploading" : "queued";
    const summary = content
      .map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "mention" || part.type === "mention_all")
          return `@${part.label}`;
        return "[图片]";
      })
      .join("")
      .trim();
    const pending = localMessage(
      clientId,
      previewParts,
      summary || `[图片] ${images.length} 张`,
      initialStatus,
    );
    await localDatabase.upsertMessages([pending]);
    if (retryClientId) {
      patchMessage(clientId, {
        ...pending,
        progress: images.length ? 0 : 100,
        error: undefined,
      });
    } else {
      updateMessages((items) => [...items, pending]);
      scrollToLatestAfterSend();
    }
    uploadRetries.current.set(clientId, () =>
      sendImageMessage(content, quote, clientId),
    );
    const upload = {
      controller: new AbortController(),
      uploadedIds: [] as number[],
      draftIds: images.map((item) => item.meta.id),
    };
    if (images.length) activeUploads.current.set(clientId, upload);
    const outgoing: OutgoingMessagePart[] = quote
      ? [{ type: "quote", messageId: quote.id }]
      : [];
    const hydrated: MessagePart[] = quote
      ? [
          {
            type: "quote",
            messageId: quote.id,
            senderId: quote.senderId,
            senderName: quote.senderName,
            summary: quote.summary,
          },
        ]
      : [];
    let uploadedImageIndex = 0;
    for (const part of content) {
      if (part.type === "text") {
        outgoing.push({ type: "text", text: part.text });
        hydrated.push({ type: "text", text: part.text });
        continue;
      }
      if (part.type === "mention") {
        outgoing.push({
          type: "mention",
          userId: part.userId,
          label: part.label,
        });
        hydrated.push({
          type: "mention",
          userId: part.userId,
          label: part.label,
        });
        continue;
      }
      if (part.type === "mention_all") {
        outgoing.push({ type: "mention_all", label: "所有人" });
        hydrated.push({ type: "mention_all", label: "所有人" });
        continue;
      }
      const image = part.item;
      try {
        const attachment = await uploadItem(
          image,
          (progress) => {
            const overall = Math.round(
              ((uploadedImageIndex + progress / 100) / images.length) * 100,
            );
            patchMessage(clientId, { progress: overall });
          },
          upload.controller.signal,
        );
        upload.uploadedIds.push(attachment.id);
        outgoing.push({
          type: "image",
          attachmentId: attachment.id,
          width: image.meta.width || 1,
          height: image.meta.height || 1,
        });
        hydrated.push({
          type: "image",
          attachment,
          width: image.meta.width || 1,
          height: image.meta.height || 1,
        });
        uploadedImageIndex += 1;
      } catch (error) {
        if (upload.controller.signal.aborted) return false;
        await Promise.all(
          upload.uploadedIds.map((id) =>
            uploadService.remove(id).catch(() => undefined),
          ),
        );
        activeUploads.current.delete(clientId);
        const message = error instanceof Error ? error.message : "图片上传失败";
        const failed: LocalMessage = {
          ...pending,
          status: "failed",
          error: { code: "UPLOAD_FAILED", message, retryable: true },
        };
        await localDatabase.upsertMessages([failed]);
        patchMessage(clientId, failed);
        return false;
      }
    }
    const ready = {
      ...pending,
      parts: hydrated,
      progress: 100,
      status: "queued" as const,
    };
    await localDatabase.upsertMessages([ready]);
    patchMessage(clientId, ready);
    activeUploads.current.delete(clientId);
    await deliver(ready, {
      conversationId: conversationId!,
      clientId,
      schemaVersion: 1,
      parts: outgoing,
    });
    uploadRetries.current.delete(clientId);
    await cleanDraftItems(images);
    return true;
  }

  async function sendFileMessage(
    item: DraftAttachmentItem,
    quote?: Message,
    retryClientId?: string,
  ) {
    const clientId = retryClientId || crypto.randomUUID();
    const pending = localMessage(
      clientId,
      [
        ...(quote
          ? [
              {
                type: "quote" as const,
                messageId: quote.id,
                senderId: quote.senderId,
                senderName: quote.senderName,
                summary: quote.summary,
              },
            ]
          : []),
        {
          type: "file",
          attachment: {
            id: -1,
            draftId: item.meta.id,
            originalName: item.meta.name,
            mimeType: item.meta.mimeType,
            size: item.meta.size,
            url: item.meta.previewUrl,
          },
        },
      ],
      `[文件] ${item.meta.name}`,
      "uploading",
    );
    await localDatabase.upsertMessages([pending]);
    if (retryClientId) {
      patchMessage(clientId, { ...pending, progress: 0, error: undefined });
    } else {
      updateMessages((items) => [...items, pending]);
      scrollToLatestAfterSend();
    }
    uploadRetries.current.set(clientId, () =>
      sendFileMessage(item, quote, clientId),
    );
    const upload = {
      controller: new AbortController(),
      uploadedIds: [] as number[],
      draftIds: [item.meta.id],
    };
    activeUploads.current.set(clientId, upload);
    try {
      const attachment = await uploadItem(
        item,
        (progress) => patchMessage(clientId, { progress }),
        upload.controller.signal,
      );
      upload.uploadedIds.push(attachment.id);
      const ready: LocalMessage = {
        ...pending,
        parts: [
          ...(quote
            ? [
                {
                  type: "quote" as const,
                  messageId: quote.id,
                  senderId: quote.senderId,
                  senderName: quote.senderName,
                  summary: quote.summary,
                },
              ]
            : []),
          { type: "file", attachment },
        ],
        status: "queued",
        progress: 100,
      };
      await localDatabase.upsertMessages([ready]);
      patchMessage(clientId, ready);
      activeUploads.current.delete(clientId);
      await deliver(ready, {
        conversationId: conversationId!,
        clientId,
        schemaVersion: 1,
        parts: [
          ...(quote ? [{ type: "quote" as const, messageId: quote.id }] : []),
          { type: "file", attachmentId: attachment.id },
        ],
      });
      uploadRetries.current.delete(clientId);
      await cleanDraftItems([item]);
      return true;
    } catch (error) {
      if (upload.controller.signal.aborted) return false;
      await Promise.all(
        upload.uploadedIds.map((id) =>
          uploadService.remove(id).catch(() => undefined),
        ),
      );
      activeUploads.current.delete(clientId);
      const message = error instanceof Error ? error.message : "文件上传失败";
      const failed: LocalMessage = {
        ...pending,
        status: "failed",
        error: { code: "UPLOAD_FAILED", message, retryable: true },
      };
      await localDatabase.upsertMessages([failed]);
      patchMessage(clientId, failed);
      return false;
    }
  }

  async function sendBatch(snapshot: ConversationDraft) {
    setSubmitting(true);
    try {
      const attachmentMap = new Map(
        snapshot.attachments.map((item) => [item.meta.id, item]),
      );
      const referencedIds = new Set<string>();
      const imageContent: ImageMessageContent[] = [];
      const files: DraftAttachmentItem[] = [];

      for (const part of composerContentParts(snapshot.text)) {
        if (
          part.type === "text" ||
          part.type === "mention" ||
          part.type === "mention_all"
        ) {
          imageContent.push(part);
          continue;
        }
        const item = attachmentMap.get(part.id);
        if (!item) continue;
        referencedIds.add(part.id);
        if (item.meta.image) imageContent.push({ type: "image", item });
        else files.push(item);
      }

      for (const item of snapshot.attachments) {
        if (referencedIds.has(item.meta.id)) continue;
        if (item.meta.image) imageContent.push({ type: "image", item });
        else files.push(item);
      }

      if (imageContent.length) {
        await sendImageMessage(imageContent, snapshot.quote);
      }
      for (let index = 0; index < files.length; index += 1) {
        await sendFileMessage(
          files[index],
          !imageContent.length && index === 0 ? snapshot.quote : undefined,
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  function submit() {
    if (
      !conversationId ||
      (!richTextToPlainText(draftState.text).trim() &&
        !draftState.attachments.length)
    )
      return;
    const snapshot = draftState;
    setConversationDraft(() => emptyConversationDraft());
    void sendBatch(snapshot);
    socket?.emit("typing:stop", {
      conversationId,
      userId: currentUser.id,
      name: currentUser.name,
    });
  }

  function changeDraft(value: string) {
    setConversationDraft((draft) => ({ ...draft, text: value }));
    if (!conversationId) return;
    socket?.emit("typing:start", {
      conversationId,
      userId: currentUser.id,
      name: currentUser.name,
    });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      socket?.emit("typing:stop", {
        conversationId,
        userId: currentUser.id,
        name: currentUser.name,
      });
    }, 1200);
  }

  async function addFiles(files: File[], source: DraftFileSource = "picker") {
    if (!files.length || !window.desktop) return;
    const staged: DraftAttachmentItem[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = normalizedDraftFile(files[index], source, index);
      const data = new Uint8Array(await file.arrayBuffer());
      const meta = await window.desktop.attachment.stage({
        name: file.name,
        mimeType: inferredMimeType(file),
        size: file.size,
        data,
      });
      if (meta.image) Object.assign(meta, await imageSize(file));
      meta.previewUrl = meta.image ? await imagePreview(file) : "";
      staged.push({ meta, file });
    }
    setConversationDraft((draft) => ({
      ...draft,
      attachments: [...draft.attachments, ...staged],
    }));
  }

  async function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await addFiles(files, "picker");
  }

  async function removeDraftAttachment(id: string) {
    const item = draftState.attachments.find((entry) => entry.meta.id === id);
    if (item) releasePreview(item.meta.previewUrl);
    setConversationDraft((draft) => ({
      ...draft,
      attachments: draft.attachments.filter((entry) => entry.meta.id !== id),
    }));
    await window.desktop?.attachment.removeDraft(id);
  }

  function quoteMessage(message?: Message) {
    setConversationDraft((draft) => ({ ...draft, quote: message }));
  }

  async function retry(clientId: string) {
    const uploadRetry = uploadRetries.current.get(clientId);
    if (uploadRetry) {
      await uploadRetry();
      return;
    }
    const item = (await localDatabase.getOutbox()).find(
      (entry) => entry.payload.clientId === clientId,
    );
    if (!item) return;
    patchMessage(clientId, { status: "sending", error: undefined });
    try {
      const saved = await chatService.send(item.payload);
      await localDatabase.markMessage({
        clientId,
        message: saved,
        status: "sent",
      });
      updateMessages((items) => [
        ...items.filter((message) => message.clientId !== clientId),
        saved,
      ]);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations,
      });
    } catch (error) {
      patchMessage(clientId, {
        status: "failed",
        error: {
          code: "SEND_FAILED",
          message: error instanceof Error ? error.message : "发送失败",
          retryable: true,
        },
      });
    }
  }

  async function cancel(clientId: string) {
    const active = activeUploads.current.get(clientId);
    if (!active) return;
    active.controller.abort();
    activeUploads.current.delete(clientId);
    uploadRetries.current.delete(clientId);
    await localDatabase.cancel(clientId).catch(() => undefined);
    await Promise.all(
      active.uploadedIds.map((id) =>
        uploadService.remove(id).catch(() => undefined),
      ),
    );
    await Promise.all(
      active.draftIds.map((id) =>
        window.desktop?.attachment.removeDraft(id).catch(() => undefined),
      ),
    );
    updateMessages((items) =>
      items.filter((message) => message.clientId !== clientId),
    );
  }

  async function removeFailed(clientId: string) {
    const message = messageItems.find((item) => item.clientId === clientId);
    uploadRetries.current.delete(clientId);
    await localDatabase.cancel(clientId).catch(() => undefined);
    const draftIds =
      message?.parts.flatMap((part) =>
        "attachment" in part && part.attachment.draftId
          ? [part.attachment.draftId]
          : [],
      ) ?? [];
    await Promise.all(
      draftIds.map((id) =>
        window.desktop?.attachment.removeDraft(id).catch(() => undefined),
      ),
    );
    updateMessages((items) =>
      items.filter((item) => item.clientId !== clientId),
    );
  }

  async function recall(target: Message) {
    if (!conversationId || target.kind !== "user" || target.id <= 0) return;
    try {
      const result = await chatService.recall(conversationId, target.id);
      applyRecall({ conversationId, ...result });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "消息撤回失败");
    }
  }

  async function loadEarlier() {
    const container = messageListRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    await messages.fetchNextPage();
    window.requestAnimationFrame(() => {
      if (container) {
        const addedHeight = container.scrollHeight - previousHeight;
        container.scrollTop += addedHeight;
      }
    });
  }

  return {
    addFiles,
    attachments: draftState.attachments,
    canSend: Boolean(
      richTextToPlainText(draftState.text).trim() ||
      draftState.attachments.length,
    ),
    cancel,
    cancelInitialScroll,
    changeDraft,
    draft: draftState.text,
    fileRef,
    imageRef,
    loadEarlier,
    messageItems,
    messageContentRef,
    messageListRef,
    messageQuery: focusedMessageId ? messageContext : messages,
    messages,
    pickFiles,
    removeDraftAttachment,
    removeFailed,
    quote: draftState.quote,
    quoteMessage,
    recall,
    retry,
    submit,
    submitting,
    typingName,
  };
}
