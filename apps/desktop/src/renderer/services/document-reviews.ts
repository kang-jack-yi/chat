import type {
  DocumentReview,
  DocumentReviewDetail,
  DocumentReviewOptions,
  DocumentReviewScope,
  SubmitDocumentReview,
} from "@chat/shared";
import { get, post } from "./request";

export const documentReviewsService = {
  /** 查询我待审批、我发起或全部参与的评审。 */
  list: (scope: DocumentReviewScope, documentId?: number) =>
    get<DocumentReview[]>("/api/document-reviews", {
      params: { scope, documentId },
    }),
  /** 读取固定提交版本及评审详情。 */
  detail: (id: number) =>
    get<DocumentReviewDetail>(`/api/document-reviews/${id}`),
  /** 读取文档可用的群聊与评审成员。 */
  options: (documentId: number) =>
    get<DocumentReviewOptions>(`/api/documents/${documentId}/review-options`),
  /** 使用稳定幂等键提交文档评审。 */
  submit: (input: SubmitDocumentReview) =>
    post<DocumentReview>("/api/document-reviews", input),
  /** 使用指定审批决定和意见处理评审，失败重试不重复建任务。 */
  decide: (
    id: number,
    input: {
      requestKey: string;
      decision: "approve" | "reject";
      comment: string;
    },
  ) => post<DocumentReview>(`/api/document-reviews/${id}/decision`, input),
};
