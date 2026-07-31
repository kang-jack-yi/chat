export function initialInviteHistorySelection(
  availableMessageIds: number[],
  selectedMessageIds: number[],
  defaultSelectAll: boolean,
) {
  if (defaultSelectAll) return [...availableMessageIds];
  const available = new Set(availableMessageIds);
  return selectedMessageIds.filter((id) => available.has(id));
}
