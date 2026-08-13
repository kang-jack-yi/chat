import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  Button,
  Checkbox,
  Dropdown,
  Image,
  Popover,
  Tooltip,
  message,
} from "antd";
import {
  ChevronDown,
  FolderOpen,
  Image as ImageIcon,
  Paperclip,
  Scissors,
  Smile,
} from "lucide-react";
import EmojiPicker, { EmojiStyle } from "emoji-picker-react";
import type { User } from "@chat/shared";
import {
  readClipboardText,
  writeClipboardImage,
  writeClipboardText,
} from "../../../services/clipboard";
import { formatFileSize } from "../../../utils/format";
import {
  composerCaretAttribute,
  draftAttachmentAttribute,
  mentionAllAttribute,
  mentionLabelAttribute,
  mentionUserIdAttribute,
  sanitizeComposerHtml,
  sanitizeRichText,
  serializeComposerElement,
} from "../../../utils/rich-text";
import type { DraftAttachmentItem } from "../hooks";

export type DraftFileSource = "clipboard" | "drop" | "picker" | "screenshot";

const mentionPanelWidth = 224;
const mentionPanelHeight = 236;
const mentionPanelMargin = 8;

export function mentionPanelPosition(
  caret: Pick<DOMRect, "left" | "top" | "bottom">,
  viewportWidth: number,
  viewportHeight: number,
) {
  const left = Math.min(
    Math.max(caret.left, mentionPanelMargin),
    Math.max(
      viewportWidth - mentionPanelWidth - mentionPanelMargin,
      mentionPanelMargin,
    ),
  );
  const spaceBelow = viewportHeight - caret.bottom;
  const top =
    spaceBelow >= mentionPanelHeight + mentionPanelMargin
      ? caret.bottom + 6
      : Math.max(mentionPanelMargin, caret.top - mentionPanelHeight - 6);
  return { left, top };
}

export interface RichTextEditorProps {
  value: string;
  attachments: DraftAttachmentItem[];
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPickImage: () => void;
  onPickFile?: () => void;
  onPasteFiles: (files: File[], source: DraftFileSource) => void;
  onRemoveAttachment: (id: string) => void;
  quoteContent?: ReactNode;
  disabled?: boolean;
  mentionUsers?: User[];
  mentionsEnabled?: boolean;
  showFilePicker?: boolean;
  placeholder?: string;
  editorClassName?: string;
  sendKey?: "enter" | "ctrlEnter";
}

export function shouldSubmitMessage(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "ctrlKey" | "metaKey" | "isComposing"
  >,
  sendKey: "enter" | "ctrlEnter",
) {
  if (event.key !== "Enter" || event.isComposing || event.shiftKey)
    return false;
  return sendKey === "enter"
    ? !event.ctrlKey && !event.metaKey
    : event.ctrlKey || event.metaKey;
}

const popupContainer = (trigger: HTMLElement) =>
  (trigger.closest("[data-chat-root]") as HTMLElement) || document.body;

function looksLikeClipboardTemporaryFile(file: File) {
  const basename = file.name.replace(/\.[^.]+$/, "");
  return !file.type && /^[a-f0-9-]{12,}$/i.test(basename);
}

function fileExtension(name: string) {
  const extension = name.split(".").pop();
  return extension && extension !== name
    ? extension.toUpperCase().slice(0, 6)
    : "FILE";
}

/** 去除 Windows 截图剪贴板附带的无类型哈希临时文件。 */
export function clipboardFiles(transfer: DataTransfer) {
  const itemFiles = Array.from(transfer.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const files = itemFiles.length ? itemFiles : Array.from(transfer.files || []);
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (!images.length) return files;
  return files.filter(
    (file) =>
      file.type.startsWith("image/") || !looksLikeClipboardTemporaryFile(file),
  );
}

function decorateAttachmentNode(node: HTMLElement, item: DraftAttachmentItem) {
  const { meta } = item;
  node.setAttribute(draftAttachmentAttribute, meta.id);
  node.setAttribute("contenteditable", "false");
  node.setAttribute("tabindex", "0");
  node.className = `composer-attachment-node ${
    meta.image ? "composer-attachment-image" : "composer-attachment-file"
  }`;
  node.title = `${meta.name} · ${formatFileSize(meta.size)}`;
  node.replaceChildren();

  if (meta.image) {
    const image = document.createElement("img");
    image.src = meta.previewUrl;
    image.alt = meta.name;
    image.draggable = false;
    node.append(image);

    const dimensions = document.createElement("small");
    dimensions.className = "composer-attachment-dimensions";
    dimensions.textContent =
      meta.width && meta.height ? `${meta.width}×${meta.height}` : "图片";
    node.append(dimensions);
  } else {
    const icon = document.createElement("span");
    icon.className = "composer-file-icon";
    icon.textContent = fileExtension(meta.name);

    const details = document.createElement("span");
    details.className = "composer-file-details";
    const name = document.createElement("strong");
    name.textContent = meta.name;
    const size = document.createElement("small");
    size.textContent = formatFileSize(meta.size);
    details.append(name, size);
    node.append(icon, details);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "composer-attachment-remove";
  remove.setAttribute("aria-label", `移除 ${meta.name}`);
  remove.setAttribute("data-remove-draft-attachment", meta.id);
  remove.textContent = "×";
  node.append(remove);
}

function ensureCaretAnchorAfter(node: HTMLElement) {
  const existing = node.nextElementSibling;
  if (existing?.hasAttribute(composerCaretAttribute))
    return existing as HTMLElement;
  const anchor = document.createElement("span");
  anchor.setAttribute(composerCaretAttribute, "true");
  anchor.className = "composer-caret-anchor";
  anchor.textContent = "\u200b";
  node.after(anchor);
  return anchor;
}

function decorateMentionNode(
  node: HTMLElement,
  mention: { userId?: number; label: string; all?: boolean },
) {
  if (mention.all) {
    node.setAttribute(mentionAllAttribute, "true");
    node.removeAttribute(mentionUserIdAttribute);
  } else {
    node.setAttribute(mentionUserIdAttribute, String(mention.userId));
    node.removeAttribute(mentionAllAttribute);
  }
  node.setAttribute(mentionLabelAttribute, mention.label);
  node.setAttribute("contenteditable", "false");
  node.className = "composer-mention-node";
  node.textContent = `@${mention.label}`;
}

export default function RichTextEditor({
  value,
  attachments,
  onChange,
  onSubmit,
  onPickImage,
  onPickFile,
  onPasteFiles,
  onRemoveAttachment,
  quoteContent,
  disabled,
  mentionUsers = [],
  mentionsEnabled = false,
  showFilePicker = true,
  placeholder = "输入消息，Enter 发送，Shift + Enter 换行",
  editorClassName = "min-h-[94px]",
  sendKey = "enter",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const mentionStartRange = useRef<Range | null>(null);
  const attachmentMap = useMemo(
    () => new Map(attachments.map((item) => [item.meta.id, item])),
    [attachments],
  );
  const [contextAttachmentId, setContextAttachmentId] = useState<string>();
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string>();
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string>();
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionPosition, setMentionPosition] = useState({ left: 8, top: 8 });
  const [hideMainWindow, setHideMainWindow] = useState(true);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const previewAttachment = previewAttachmentId
    ? attachmentMap.get(previewAttachmentId)
    : undefined;
  const filteredMentionUsers = mentionUsers.filter(
    (user) =>
      !mentionQuery ||
      user.name.toLowerCase().includes(mentionQuery.toLowerCase()),
  );
  const mentionOptions = [
    { all: true, label: "所有人" },
    ...filteredMentionUsers.map((user) => ({
      userId: user.id,
      label: user.name,
      avatar: user.avatar,
    })),
  ];

  function saveSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange();
    }
  }

  async function captureScreenshot() {
    if (disabled || screenshotBusy || !window.desktop?.screenshot) return;
    saveSelection();
    setScreenshotBusy(true);
    try {
      const result = await window.desktop.screenshot.capture({
        hideMainWindow,
      });
      if (result.canceled) return;
      const file = new File([new Uint8Array(result.data)], result.name, {
        type: result.mimeType,
      });
      onPasteFiles([file], "screenshot");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "截图失败");
    } finally {
      setScreenshotBusy(false);
    }
  }

  useEffect(() => {
    if (!showFilePicker) return;
    void window.desktop?.screenshot
      .getPreferences()
      .then((preferences) => {
        setHideMainWindow(preferences.hideMainWindow);
        if (!preferences.shortcutAvailable) {
          message.warning("截图快捷键 Ctrl/Cmd + Shift + G 已被其他应用占用");
        }
      })
      .catch(() => undefined);
  }, [showFilePicker]);

  useEffect(() => {
    if (!showFilePicker) return;
    return window.desktop?.screenshot.onShortcut(() => {
      void captureScreenshot();
    });
  }, [disabled, hideMainWindow, screenshotBusy, showFilePicker]);

  function restoreSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;
    editor.focus();
    selection.removeAllRanges();
    if (
      savedRange.current &&
      editor.contains(savedRange.current.commonAncestorContainer)
    ) {
      selection.addRange(savedRange.current);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.addRange(range);
  }

  function selectedText() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return "";
    const range = selection.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer)
      ? selection.toString()
      : "";
  }

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(serializeComposerElement(editor));
    saveSelection();
  }

  function updateMentionQuery() {
    if (!mentionOpen || !mentionStartRange.current || !savedRange.current)
      return;
    try {
      const range = document.createRange();
      range.setStart(
        mentionStartRange.current.startContainer,
        mentionStartRange.current.startOffset,
      );
      range.setEnd(
        savedRange.current.endContainer,
        savedRange.current.endOffset,
      );
      const text = range.toString();
      if (
        !text.startsWith("@") ||
        /\s/.test(text.slice(1)) ||
        text.length > 40
      ) {
        setMentionOpen(false);
        return;
      }
      setMentionQuery(text.slice(1));
      setMentionIndex(0);
    } catch {
      setMentionOpen(false);
    }
  }

  function insertMention(mention: {
    userId?: number;
    label: string;
    all?: boolean;
  }) {
    const editor = editorRef.current;
    const current = savedRange.current;
    const start = mentionStartRange.current;
    if (!editor || !current || !start) return;
    try {
      const range = document.createRange();
      range.setStart(start.startContainer, start.startOffset);
      range.setEnd(current.endContainer, current.endOffset);
      range.deleteContents();
      const node = document.createElement("span");
      decorateMentionNode(node, mention);
      range.insertNode(node);
      const anchor = ensureCaretAnchorAfter(node);
      range.selectNodeContents(anchor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      savedRange.current = range.cloneRange();
      mentionStartRange.current = null;
      setMentionOpen(false);
      setMentionQuery("");
      emitChange();
    } catch {
      setMentionOpen(false);
    }
  }

  function insertAttachment(item: DraftAttachmentItem) {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const rangeElement =
      range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement;
    const currentAnchor = rangeElement?.closest<HTMLElement>(
      `[${composerCaretAttribute}]`,
    );
    if (currentAnchor) {
      range.setStartAfter(currentAnchor);
      range.collapse(true);
    }
    const node = document.createElement("span");
    decorateAttachmentNode(node, item);
    range.deleteContents();
    range.insertNode(node);
    const anchor = ensureCaretAnchorAfter(node);
    range.selectNodeContents(anchor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange.current = range.cloneRange();
  }

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const normalizedValue = sanitizeComposerHtml(value);
    if (serializeComposerElement(editor) !== normalizedValue) {
      editor.innerHTML = normalizedValue;
      savedRange.current = null;
    }

    const validIds = new Set(attachments.map((item) => item.meta.id));
    editor
      .querySelectorAll<HTMLElement>(`[${draftAttachmentAttribute}]`)
      .forEach((node) => {
        const id = node.getAttribute(draftAttachmentAttribute) || "";
        const item = attachmentMap.get(id);
        if (!item) {
          node.remove();
          return;
        }
        if (!node.classList.contains("composer-attachment-node")) {
          decorateAttachmentNode(node, item);
        }
        ensureCaretAnchorAfter(node);
      });
    editor
      .querySelectorAll<HTMLElement>(
        `[${mentionUserIdAttribute}], [${mentionAllAttribute}]`,
      )
      .forEach((node) => {
        const all = node.hasAttribute(mentionAllAttribute);
        const userId = Number(node.getAttribute(mentionUserIdAttribute));
        const label = all
          ? "所有人"
          : String(node.getAttribute(mentionLabelAttribute) || "");
        if (!all && (!Number.isSafeInteger(userId) || userId <= 0 || !label)) {
          node.replaceWith(document.createTextNode(node.textContent || ""));
          return;
        }
        decorateMentionNode(node, { all, userId, label });
        ensureCaretAnchorAfter(node);
      });

    const currentIds = new Set(
      Array.from(
        editor.querySelectorAll<HTMLElement>(`[${draftAttachmentAttribute}]`),
      )
        .map((node) => node.getAttribute(draftAttachmentAttribute) || "")
        .filter((id) => validIds.has(id)),
    );
    const missing = attachments.filter((item) => !currentIds.has(item.meta.id));
    if (missing.length) {
      missing.forEach(insertAttachment);
      emitChange();
    }
  }, [attachmentMap, attachments, value]);

  function insertText(text: string, html?: string) {
    restoreSelection();
    document.execCommand(
      html ? "insertHTML" : "insertText",
      false,
      html || text,
    );
    emitChange();
  }

  function reconcileRemovedAttachments() {
    const editor = editorRef.current;
    if (!editor) return;
    const present = new Set(
      Array.from(
        editor.querySelectorAll<HTMLElement>(`[${draftAttachmentAttribute}]`),
      ).map((node) => node.getAttribute(draftAttachmentAttribute) || ""),
    );
    attachments.forEach((item) => {
      if (!present.has(item.meta.id)) onRemoveAttachment(item.meta.id);
    });
  }

  function removeAttachment(id: string) {
    const editor = editorRef.current;
    const node = editor?.querySelector<HTMLElement>(
      `[${draftAttachmentAttribute}="${CSS.escape(id)}"]`,
    );
    const anchor = node?.nextElementSibling?.hasAttribute(
      composerCaretAttribute,
    )
      ? (node.nextElementSibling as HTMLElement)
      : undefined;
    if (anchor) {
      const text = (anchor.textContent || "").replace(/\u200b/g, "");
      if (text) anchor.replaceWith(document.createTextNode(text));
      else anchor.remove();
    }
    node?.remove();
    if (selectedAttachmentId === id) setSelectedAttachmentId(undefined);
    if (contextAttachmentId === id) setContextAttachmentId(undefined);
    emitChange();
    onRemoveAttachment(id);
  }

  function paste(event: React.ClipboardEvent<HTMLDivElement>) {
    saveSelection();
    const files = clipboardFiles(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      onPasteFiles(files, "clipboard");
      return;
    }
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    insertText(text, html ? sanitizeRichText(html) : undefined);
  }

  function drop(event: React.DragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    event.preventDefault();
    saveSelection();
    onPasteFiles(files, "drop");
  }

  async function pasteFromSystemClipboard() {
    try {
      const clipboardItems = await navigator.clipboard.read();
      const imageFiles: File[] = [];
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const extension = imageType.split("/")[1] || "png";
        imageFiles.push(
          new File([blob], `剪贴板图片-${Date.now()}.${extension}`, {
            type: imageType,
          }),
        );
      }
      if (imageFiles.length) {
        onPasteFiles(imageFiles, "clipboard");
        return;
      }
    } catch {
      // Electron 未授予异步图片剪贴板权限时继续读取纯文本。
    }
    const text = await readClipboardText().catch(() => "");
    if (text) insertText(text);
  }

  const editorMenu = {
    items: [
      {
        key: "cut",
        label: "剪切",
        onClick: async () => {
          restoreSelection();
          const text = selectedText();
          if (!text) return;
          await writeClipboardText(text);
          restoreSelection();
          document.execCommand("delete");
          emitChange();
        },
      },
      {
        key: "copy",
        label: "复制",
        onClick: async () => {
          restoreSelection();
          const text = selectedText();
          if (text) await writeClipboardText(text);
        },
      },
      {
        key: "paste",
        label: "粘贴",
        onClick: () => void pasteFromSystemClipboard(),
      },
      { type: "divider" as const },
      {
        key: "select-all",
        label: "全选",
        onClick: () => {
          const editor = editorRef.current;
          const selection = window.getSelection();
          if (!editor || !selection) return;
          const range = document.createRange();
          range.selectNodeContents(editor);
          selection.removeAllRanges();
          selection.addRange(range);
          saveSelection();
        },
      },
    ],
  };

  const contextAttachment = contextAttachmentId
    ? attachmentMap.get(contextAttachmentId)
    : undefined;
  const attachmentMenu = contextAttachment
    ? {
        items: [
          ...(contextAttachment.meta.image
            ? [
                {
                  key: "preview",
                  label: "查看图片",
                  onClick: () =>
                    setPreviewAttachmentId(contextAttachment.meta.id),
                },
                {
                  key: "copy-image",
                  label: "复制图片",
                  onClick: async () => {
                    const blob = await fetch(
                      contextAttachment.meta.previewUrl,
                    ).then((response) => response.blob());
                    await writeClipboardImage(blob);
                  },
                },
              ]
            : [
                {
                  key: "open",
                  label: "打开文件",
                  icon: <FolderOpen size={14} />,
                  onClick: () =>
                    void window.desktop?.attachment.open({
                      draftId: contextAttachment.meta.id,
                    }),
                },
                {
                  key: "copy-name",
                  label: "复制文件名",
                  onClick: () =>
                    void writeClipboardText(contextAttachment.meta.name),
                },
              ]),
          { type: "divider" as const },
          {
            key: "remove",
            label: "从草稿移除",
            danger: true,
            onClick: () => removeAttachment(contextAttachment.meta.id),
          },
        ],
      }
    : editorMenu;

  const emojiPanel = (
    <EmojiPicker
      width={340}
      height={400}
      emojiStyle={EmojiStyle.NATIVE}
      lazyLoadEmojis
      searchPlaceHolder="搜索表情"
      previewConfig={{ showPreview: false }}
      onEmojiClick={(emoji) => insertText(emoji.emoji)}
    />
  );

  return (
    <>
      <div className="flex h-9 items-center gap-1 border-b border-[var(--chat-line)] pb-1">
        <Popover content={emojiPanel} trigger="click" placement="topLeft">
          <Tooltip title="表情">
            <Button
              type="text"
              size="small"
              disabled={disabled}
              icon={<Smile size={19} />}
            />
          </Tooltip>
        </Popover>
        <Tooltip title="选择图片">
          <Button
            type="text"
            size="small"
            disabled={disabled}
            icon={<ImageIcon size={19} />}
            onClick={() => {
              saveSelection();
              onPickImage();
            }}
          />
        </Tooltip>
        {showFilePicker && (
          <>
            <Tooltip title="选择文件">
              <Button
                type="text"
                size="small"
                disabled={disabled}
                icon={<Paperclip size={19} />}
                onClick={() => {
                  saveSelection();
                  onPickFile?.();
                }}
              />
            </Tooltip>
            <div className="flex items-center">
              <Tooltip title="截图 (Ctrl/Cmd + Shift + G)">
                <Button
                  type="text"
                  size="small"
                  disabled={disabled || screenshotBusy}
                  icon={<Scissors size={18} />}
                  onClick={() => void captureScreenshot()}
                />
              </Tooltip>
              <Dropdown
                trigger={["click"]}
                getPopupContainer={popupContainer}
                menu={{
                  items: [
                    {
                      key: "capture",
                      label: (
                        <span className="flex min-w-48 items-center justify-between gap-5">
                          <span>截图</span>
                          <span className="text-xs text-[var(--chat-muted)]">
                            {navigator.platform.includes("Mac")
                              ? "⌘⇧G"
                              : "Ctrl+Shift+G"}
                          </span>
                        </span>
                      ),
                      onClick: () => void captureScreenshot(),
                    },
                    {
                      key: "hide-main-window",
                      label: (
                        <Checkbox
                          checked={hideMainWindow}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setHideMainWindow(checked);
                            void window.desktop?.screenshot
                              .setPreferences({
                                hideMainWindow: checked,
                              })
                              .catch((error: unknown) => {
                                message.error(
                                  error instanceof Error
                                    ? error.message
                                    : "无法保存截图设置",
                                );
                              });
                          }}
                        >
                          隐藏聊天窗口
                        </Checkbox>
                      ),
                    },
                  ],
                }}
              >
                <Button
                  type="text"
                  size="small"
                  disabled={disabled}
                  aria-label="截图设置"
                  className="!-ml-2 !w-5 !min-w-5 !px-0"
                  icon={<ChevronDown size={12} />}
                />
              </Dropdown>
            </div>
          </>
        )}
      </div>

      <div className="relative max-h-[calc(var(--composer-height,346px)-60px)] overflow-y-auto pt-2">
        {quoteContent && <div className="mb-1 px-1">{quoteContent}</div>}
        <Dropdown
          trigger={["contextMenu"]}
          menu={attachmentMenu}
          getPopupContainer={popupContainer}
        >
          <div
            ref={editorRef}
            className={`rich-text-editor px-1 py-2 text-sm leading-6 text-[var(--chat-text)] outline-none ${editorClassName}`}
            contentEditable={!disabled}
            suppressContentEditableWarning
            data-placeholder={placeholder}
            onInput={() => {
              reconcileRemovedAttachments();
              emitChange();
              updateMentionQuery();
            }}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onClick={(event) => {
              const target = event.target as HTMLElement;
              const removeId = target
                .closest<HTMLElement>("[data-remove-draft-attachment]")
                ?.getAttribute("data-remove-draft-attachment");
              if (removeId) {
                event.preventDefault();
                removeAttachment(removeId);
                return;
              }
              const attachmentNode = target.closest<HTMLElement>(
                `[${draftAttachmentAttribute}]`,
              );
              editorRef.current
                ?.querySelectorAll(".is-selected")
                .forEach((node) => node.classList.remove("is-selected"));
              if (attachmentNode) {
                const id =
                  attachmentNode.getAttribute(draftAttachmentAttribute) || "";
                attachmentNode.classList.add("is-selected");
                setSelectedAttachmentId(id);
              } else {
                setSelectedAttachmentId(undefined);
                saveSelection();
              }
            }}
            onDoubleClick={(event) => {
              const id = (event.target as HTMLElement)
                .closest<HTMLElement>(`[${draftAttachmentAttribute}]`)
                ?.getAttribute(draftAttachmentAttribute);
              if (!id) return;
              const item = attachmentMap.get(id);
              if (item?.meta.image) setPreviewAttachmentId(id);
              else if (item)
                void window.desktop?.attachment.open({ draftId: id });
            }}
            onContextMenuCapture={(event) => {
              const id = (event.target as HTMLElement)
                .closest<HTMLElement>(`[${draftAttachmentAttribute}]`)
                ?.getAttribute(draftAttachmentAttribute);
              flushSync(() => setContextAttachmentId(id || undefined));
              if (!id) saveSelection();
            }}
            onPaste={paste}
            onDrop={drop}
            onDragOver={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (
                selectedAttachmentId &&
                (event.key === "Backspace" || event.key === "Delete")
              ) {
                event.preventDefault();
                removeAttachment(selectedAttachmentId);
                return;
              }
              if (mentionOpen && event.key === "Escape") {
                event.preventDefault();
                setMentionOpen(false);
                return;
              }
              if (
                mentionsEnabled &&
                event.key === "@" &&
                !event.ctrlKey &&
                !event.metaKey
              ) {
                const selection = window.getSelection();
                if (selection?.rangeCount) {
                  mentionStartRange.current = selection
                    .getRangeAt(0)
                    .cloneRange();
                  window.requestAnimationFrame(() => {
                    saveSelection();
                    const range = window.getSelection()?.rangeCount
                      ? window.getSelection()!.getRangeAt(0)
                      : undefined;
                    if (range) {
                      const caret = range.getBoundingClientRect();
                      setMentionPosition(
                        mentionPanelPosition(
                          caret,
                          window.innerWidth,
                          window.innerHeight,
                        ),
                      );
                    }
                    setMentionQuery("");
                    setMentionIndex(0);
                    setMentionOpen(true);
                  });
                }
              }
              if (mentionOpen && event.key === "ArrowDown") {
                event.preventDefault();
                setMentionIndex((index) => (index + 1) % mentionOptions.length);
                return;
              }
              if (mentionOpen && event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex(
                  (index) =>
                    (index - 1 + mentionOptions.length) % mentionOptions.length,
                );
                return;
              }
              if (mentionOpen && event.key === "Enter") {
                event.preventDefault();
                insertMention(
                  mentionOptions[mentionIndex] || mentionOptions[0],
                );
                return;
              }
              if (
                shouldSubmitMessage(
                  {
                    key: event.key,
                    shiftKey: event.shiftKey,
                    ctrlKey: event.ctrlKey,
                    metaKey: event.metaKey,
                    isComposing: event.nativeEvent.isComposing,
                  },
                  sendKey,
                )
              ) {
                event.preventDefault();
                onSubmit();
              }
            }}
            role="textbox"
            aria-label="消息输入框"
            aria-multiline="true"
          />
        </Dropdown>
        {mentionsEnabled &&
          mentionOpen &&
          createPortal(
            <div
              className="fixed z-[2100] w-56 overflow-hidden rounded-lg border border-[var(--chat-line)] bg-[var(--app-surface)] py-1 shadow-[var(--app-shadow-float)]"
              style={mentionPosition}
            >
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--app-surface-muted)] ${
                  mentionIndex === 0 ? "bg-[var(--app-surface-muted)]" : ""
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMention({ all: true, label: "所有人" })}
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--chat-primary-soft)] text-xs text-[var(--chat-primary)]">
                  @
                </span>
                <span>所有人</span>
              </button>
              <div className="max-h-48 overflow-y-auto">
                {filteredMentionUsers.map((user, index) => (
                  <button
                    key={user.id}
                    type="button"
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--app-surface-muted)] ${
                      mentionIndex === index + 1
                        ? "bg-[var(--app-surface-muted)]"
                        : ""
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      insertMention({ userId: user.id, label: user.name })
                    }
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--app-primary-soft)] text-xs text-[var(--app-primary)]">
                      {user.avatar || user.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{user.name}</span>
                  </button>
                ))}
                {!filteredMentionUsers.length && (
                  <div className="px-3 py-3 text-center text-xs text-[var(--chat-text-tertiary)]">
                    没有匹配成员
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )}
      </div>

      {previewAttachment?.meta.image && (
        <Image.PreviewGroup
          items={[
            {
              src: previewAttachment.meta.previewUrl,
              alt: previewAttachment.meta.name,
            },
          ]}
          preview={{
            open: true,
            onOpenChange: (open) => {
              if (!open) setPreviewAttachmentId(undefined);
            },
          }}
        />
      )}
    </>
  );
}
