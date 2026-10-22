import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import type {
  DocumentReview,
  DocumentReviewDetail,
  DocumentReviewOptions,
  DocumentReviewScope,
  SubmitDocumentReview,
} from "@chat/shared";
import { documentReviewsService } from "./document-reviews";
import { ApiError, httpClient } from "./request";
import { notificationRoute } from "../pages/Search/helpers";

describe("document reviews service", () => {
  let previousAdapter: typeof httpClient.defaults.adapter;
  let adapter: ReturnType<typeof vi.fn<AxiosAdapter>>;
  let response: unknown;

  beforeEach(() => {
    previousAdapter = httpClient.defaults.adapter;
    response = { success: true, data: { id: 41 } };
    adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({
      data: response,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    }));
    httpClient.defaults.adapter = adapter;
  });

  afterEach(() => {
    httpClient.defaults.adapter = previousAdapter;
    vi.restoreAllMocks();
  });

  it.each<DocumentReviewScope>(["pending", "submitted", "all"])(
    "以 GET 查询 %s 范围，并传递可选文档过滤",
    async (scope) => {
      response = { success: true, data: [{ id: 41 }] };
      expect(await documentReviewsService.list(scope, 7)).toEqual([{ id: 41 }]);
      expect(adapter).toHaveBeenCalledOnce();
      expect(adapter.mock.calls[0][0]).toMatchObject({
        url: "/api/document-reviews",
        method: "get",
        params: { scope, documentId: 7 },
      });
      await documentReviewsService.list(scope);
      expect(adapter.mock.calls[1][0].params).toEqual({
        scope,
        documentId: undefined,
      });
    },
  );

  it("详情与候选成员使用不同的评审和文档路径，并解包响应", async () => {
    expect(await documentReviewsService.detail(41)).toEqual({ id: 41 });
    expect(adapter.mock.calls[0][0]).toMatchObject({
      url: "/api/document-reviews/41",
      method: "get",
    });
    response = { success: true, data: { groups: [] } };
    expect(await documentReviewsService.options(7)).toEqual({ groups: [] });
    expect(adapter.mock.calls[1][0]).toMatchObject({
      url: "/api/documents/7/review-options",
      method: "get",
    });
  });

  it("提交以 POST 原样传递全部字段和调用方提供的幂等键", async () => {
    const input: SubmitDocumentReview = {
      documentId: 7,
      conversationId: 8,
      approverId: 2,
      assigneeId: 3,
      title: "发布跟进",
      dueAt: "2026-11-01T12:00:00.000Z",
      requestKey: "stable-submit-key",
    };
    expect(await documentReviewsService.submit(input)).toEqual({ id: 41 });
    const config = adapter.mock.calls[0][0];
    expect(config).toMatchObject({
      url: "/api/document-reviews",
      method: "post",
    });
    expect(JSON.parse(config.data)).toEqual(input);
  });

  it.each(["approve", "reject"] as const)(
    "%s 决定以 POST 发送到评审专属路径，重试不替换 requestKey",
    async (decision) => {
      const input = {
        decision,
        comment: "审批意见",
        requestKey: "stable-decision-key",
      };
      response = {
        success: false,
        error: { code: "CONFLICT", message: "状态冲突" },
      };
      await expect(
        documentReviewsService.decide(41, input),
      ).rejects.toMatchObject({
        name: "ApiError",
        code: "CONFLICT",
        message: "状态冲突",
      });
      response = { success: true, data: { id: 41 } };
      expect(await documentReviewsService.decide(41, input)).toEqual({
        id: 41,
      });
      expect(adapter).toHaveBeenCalledTimes(2);
      for (const [config] of adapter.mock.calls) {
        expect(config).toMatchObject({
          url: "/api/document-reviews/41/decision",
          method: "post",
        });
        expect(JSON.parse(config.data)).toEqual(input);
      }
    },
  );

  it("读取候选成员的业务失败不会伪装为空列表", async () => {
    response = {
      success: false,
      error: { code: "FORBIDDEN", message: "无文档权限" },
    };
    await expect(documentReviewsService.options(7)).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("公开参数和返回类型与 shared 审批契约一致", () => {
    expectTypeOf(documentReviewsService.list).parameters.toEqualTypeOf<
      [DocumentReviewScope, number?]
    >();
    expectTypeOf(documentReviewsService.list).returns.toEqualTypeOf<
      Promise<DocumentReview[]>
    >();
    expectTypeOf(documentReviewsService.detail).returns.toEqualTypeOf<
      Promise<DocumentReviewDetail>
    >();
    expectTypeOf(documentReviewsService.options).returns.toEqualTypeOf<
      Promise<DocumentReviewOptions>
    >();
    expectTypeOf(documentReviewsService.submit).parameters.toEqualTypeOf<
      [SubmitDocumentReview]
    >();
    expectTypeOf(documentReviewsService.submit).returns.toEqualTypeOf<
      Promise<DocumentReview>
    >();
    expectTypeOf(documentReviewsService.decide).parameters.toEqualTypeOf<
      [
        number,
        { requestKey: string; decision: "approve" | "reject"; comment: string },
      ]
    >();
    expectTypeOf(documentReviewsService.decide).returns.toEqualTypeOf<
      Promise<DocumentReview>
    >();
  });
});

describe("document review notification route", () => {
  it("评审深链接优先于通知中同时存在的任务和群聊", () => {
    expect(
      notificationRoute({
        entityType: "document_review",
        entityId: "41",
        taskId: 90,
        conversationId: 8,
      }),
    ).toBe("/reviews?reviewId=41");
  });

  it.each(["", "0", "-1", "abc", "1.5", "9007199254740992"])(
    "无效评审标识 %s 不回退到可能误导的任务或会话",
    (entityId) => {
      expect(
        notificationRoute({
          entityType: "document_review",
          entityId,
          taskId: 90,
          conversationId: 8,
        }),
      ).toBeUndefined();
    },
  );

  it("普通通知继续遵循任务优先于群聊的跳转规则", () => {
    expect(
      notificationRoute({
        entityType: "task",
        entityId: "90",
        taskId: 90,
        conversationId: 8,
      }),
    ).toBe("/tasks?taskId=90");
    expect(
      notificationRoute({
        entityType: "message",
        entityId: "12",
        taskId: null,
        conversationId: 8,
      }),
    ).toBe("/chat/8");
  });
});
