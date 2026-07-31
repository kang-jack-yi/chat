import type { LocalMessage, Message } from "@chat/shared";

export function isSelectableMessage(message: Message) {
  const status = (message as Partial<LocalMessage>).status || "sent";
  return message.id > 0
    && !message.deletedAt
    && status === "sent"
    && (message.kind === "user" || message.kind === "announcement");
}

export function getSelectableRange(
  messages: Message[],
  anchorId: number | undefined,
  limit = 30,
) {
  const anchorIndex = messages.findIndex((message) => message.id === anchorId);
  if (anchorIndex < 0) return { messages: [], hasMore: false };
  const eligible = messages.slice(anchorIndex).filter(isSelectableMessage);
  return {
    messages: eligible.slice(0, limit),
    hasMore: eligible.length > limit,
  };
}

export function toggleRangeSelection(
  current: ReadonlySet<number>,
  rangeIds: number[],
  limit = 30,
) {
  const selected = new Set(current);
  const allSelected = rangeIds.length > 0 && rangeIds.every((id) => selected.has(id));
  if (allSelected) {
    rangeIds.forEach((id) => selected.delete(id));
    return { selected, cleared: true, truncated: false };
  }

  let truncated = false;
  for (const id of rangeIds) {
    if (!selected.has(id) && selected.size >= limit) {
      truncated = true;
      break;
    }
    selected.add(id);
  }
  return { selected, cleared: false, truncated };
}
