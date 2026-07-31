export type { ApiResponse } from "@chat/shared";

export interface MessagePage<T> {
  items: T[];
  nextCursor: number | null;
}
