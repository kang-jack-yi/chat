import DOMPurify from "dompurify";

export const draftAttachmentAttribute = "data-draft-attachment-id";
export const composerCaretAttribute = "data-composer-caret-anchor";
export const mentionUserIdAttribute = "data-mention-user-id";
export const mentionAllAttribute = "data-mention-all";
export const mentionLabelAttribute = "data-mention-label";

const textTags = ["b", "strong", "i", "em", "u", "p", "div", "br", "ul", "ol", "li"];
const blockTags = new Set(["DIV", "P", "LI", "UL", "OL"]);

export interface ComposerTextPart {
  type: "text";
  text: string;
}

export interface ComposerAttachmentPart {
  type: "attachment";
  id: string;
}

export interface ComposerMentionPart {
  type: "mention";
  userId: number;
  label: string;
}

export interface ComposerMentionAllPart {
  type: "mention_all";
  label: "所有人";
}

export type ComposerContentPart =
  | ComposerTextPart
  | ComposerAttachmentPart
  | ComposerMentionPart
  | ComposerMentionAllPart;

export function sanitizeRichText(value: string) {
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: textTags,
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
  });
}

export function sanitizeComposerHtml(value: string) {
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [...textTags, "span"],
    ALLOWED_ATTR: [
      draftAttachmentAttribute,
      mentionUserIdAttribute,
      mentionAllAttribute,
      mentionLabelAttribute,
    ],
    ALLOW_DATA_ATTR: true,
  });
}

export function serializeComposerElement(editor: HTMLElement) {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>(`[${composerCaretAttribute}]`).forEach((node) => {
    node.replaceWith(document.createTextNode(
      (node.textContent || "").replace(/\u200b/g, ""),
    ));
  });
  clone.querySelectorAll<HTMLElement>(`[${draftAttachmentAttribute}]`).forEach((node) => {
    const marker = document.createElement("span");
    marker.setAttribute(
      draftAttachmentAttribute,
      node.getAttribute(draftAttachmentAttribute) || "",
    );
    node.replaceWith(marker);
  });
  clone.querySelectorAll<HTMLElement>(
    `[${mentionUserIdAttribute}], [${mentionAllAttribute}]`,
  ).forEach((node) => {
    const marker = document.createElement("span");
    const label = node.getAttribute(mentionLabelAttribute) || "";
    if (node.hasAttribute(mentionAllAttribute)) {
      marker.setAttribute(mentionAllAttribute, "true");
      marker.setAttribute(mentionLabelAttribute, "所有人");
      marker.textContent = "@所有人";
    } else {
      marker.setAttribute(
        mentionUserIdAttribute,
        node.getAttribute(mentionUserIdAttribute) || "",
      );
      marker.setAttribute(mentionLabelAttribute, label);
      marker.textContent = `@${label}`;
    }
    node.replaceWith(marker);
  });
  return sanitizeComposerHtml(clone.innerHTML);
}

export function composerContentParts(value: string): ComposerContentPart[] {
  const container = document.createElement("div");
  container.innerHTML = sanitizeComposerHtml(value);
  const parts: ComposerContentPart[] = [];
  let text = "";

  const appendText = (valueToAppend: string) => {
    text += valueToAppend
      .replace(/\u00a0/g, " ")
      .replace(/\u200b/g, "");
  };
  const flushText = () => {
    const normalized = text.replace(/\n{3,}/g, "\n\n");
    if (normalized.trim()) parts.push({ type: "text", text: normalized });
    text = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent || "");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const attachmentId = node.getAttribute(draftAttachmentAttribute);
    if (attachmentId) {
      flushText();
      parts.push({ type: "attachment", id: attachmentId });
      return;
    }
    if (node.hasAttribute(mentionAllAttribute)) {
      flushText();
      parts.push({ type: "mention_all", label: "所有人" });
      return;
    }
    const mentionUserId = Number(node.getAttribute(mentionUserIdAttribute));
    const mentionLabel = String(node.getAttribute(mentionLabelAttribute) || "").trim();
    if (Number.isSafeInteger(mentionUserId) && mentionUserId > 0 && mentionLabel) {
      flushText();
      parts.push({ type: "mention", userId: mentionUserId, label: mentionLabel });
      return;
    }
    if (node.tagName === "BR") {
      appendText("\n");
      return;
    }
    Array.from(node.childNodes).forEach(walk);
    if (blockTags.has(node.tagName) && text && !text.endsWith("\n")) {
      appendText("\n");
    }
  };

  Array.from(container.childNodes).forEach(walk);
  flushText();
  return parts;
}

export function richTextToPlainText(value: string) {
  return composerContentParts(value)
    .filter((part) => part.type === "text" || part.type === "mention" || part.type === "mention_all")
    .map((part) => part.type === "text" ? part.text : `@${part.label}`)
    .join("")
    .trim();
}
