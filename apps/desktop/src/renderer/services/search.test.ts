import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "./request";
import { searchService, workspaceSearchKey, type WorkspaceSearchQuery } from "./search";

vi.mock("./request", () => ({ get: vi.fn() }));

const query: WorkspaceSearchQuery = { q: "季度计划", type: "all", limit: 20, offset: 0 };

describe("workspace search service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes keyword, type and pagination through to the permission-scoped endpoint", async () => {
    const page = { items: [], total: 0, hasMore: false };
    vi.mocked(get).mockResolvedValue(page);
    expect(await searchService.search(query)).toBe(page);
    expect(get).toHaveBeenCalledWith("/api/search", { params: query, signal: undefined });
  });

  it("propagates cancellation so superseded searches can be aborted", async () => {
    const controller = new AbortController();
    await searchService.search({ ...query, type: "document", offset: 20 }, controller.signal);
    expect(get).toHaveBeenCalledWith("/api/search", {
      params: { q: "季度计划", type: "document", limit: 20, offset: 20 },
      signal: controller.signal,
    });
  });

  it("propagates backend search failures for the page's error state", async () => {
    vi.mocked(get).mockRejectedValue(new Error("权限校验失败"));
    await expect(searchService.search(query)).rejects.toThrow("权限校验失败");
  });

  it("includes every search parameter in the cache key", () => {
    expect(workspaceSearchKey(query)).toEqual(["workspace-search", "季度计划", "all", 20, 0]);
    for (const change of [{ q: "新计划" }, { type: "task" as const }, { limit: 10 }, { offset: 20 }]) {
      expect(workspaceSearchKey({ ...query, ...change })).not.toEqual(workspaceSearchKey(query));
    }
  });
});
