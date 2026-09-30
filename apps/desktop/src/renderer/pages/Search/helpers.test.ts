import { describe, expect, it } from "vitest";
import type { WorkspaceSearchHit } from "@chat/shared";
import { includeSearchTarget, notificationRoute, searchResultRoute, searchTargetId } from "./helpers";

/** 构造服务端搜索结果，保持测试只观察公开跳转和定位行为。 */
function hit(type: WorkspaceSearchHit["type"], fields: Partial<WorkspaceSearchHit> = {}): WorkspaceSearchHit {
  return { type, id: 7, title: "季度计划", snippet: "计划正文", updatedAt: "2026-09-30T00:00:00Z", ...fields };
}

describe("workspace search navigation", () => {
  it("opens a message's conversation with its precise message id", () => {
    expect(searchResultRoute(hit("message", { conversationId: 42, messageId: 123 }))).toBe("/chat/42?messageId=123");
  });

  it("falls back to a message hit id but never guesses its conversation", () => {
    expect(searchResultRoute(hit("message", { conversationId: 42 }))).toBe("/chat/42?messageId=7");
    expect(searchResultRoute(hit("message"))).toBeUndefined();
  });

  it.each([
    [hit("member", { userId: 12 }), "/contacts/12"],
    [hit("task", { taskId: 99 }), "/tasks?taskId=99"],
    [hit("notification", { notificationId: 88 }), "/notifications?notificationId=88"],
    [hit("member"), "/contacts/7"],
    [hit("task"), "/tasks?taskId=7"],
    [hit("notification"), "/notifications?notificationId=7"],
  ])("keeps the resource target in its route", (item, expected) => {
    expect(searchResultRoute(item)).toBe(expected);
  });

  it("leaves documents to the existing independent document window", () => {
    expect(searchResultRoute(hit("document", { documentId: 99 }))).toBeUndefined();
  });

  it("prioritizes task navigation even when a due notification has a conversation", () => {
    expect(notificationRoute({ taskId: 17, conversationId: 42 })).toBe("/tasks?taskId=17");
    expect(notificationRoute({ taskId: null, conversationId: 42 })).toBe("/chat/42");
    expect(notificationRoute({ taskId: null, conversationId: null })).toBeUndefined();
  });
});

describe("search target ids", () => {
  it("accepts positive safe integer ids", () => {
    expect(searchTargetId("42")).toBe(42);
  });

  it.each([null, "", "0", "-1", "1.5", "1e2", "Infinity", "abc", "9007199254740992"])("ignores invalid target %s", (value) => {
    expect(searchTargetId(value)).toBeUndefined();
  });
});

describe("search result visibility", () => {
  it("makes a notification older than the current list visible", () => {
    const recent = [{ id: 102 }, { id: 101 }];
    expect(includeSearchTarget(recent, { id: 7 })).toEqual([{ id: 7 }, { id: 102 }, { id: 101 }]);
  });

  it("does not duplicate a target already in the list or change its order", () => {
    const items = [{ id: 9 }, { id: 7 }];
    expect(includeSearchTarget(items, { id: 7 })).toBe(items);
    expect(includeSearchTarget(items)).toBe(items);
  });
});
