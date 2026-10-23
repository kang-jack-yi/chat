import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Skeleton,
  Tag,
  message,
} from "antd";
import { ClipboardCheck, FileCheck2, FileText, RefreshCw } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  DocumentReview,
  DocumentReviewDetail,
  DocumentReviewScope,
} from "@chat/shared";
import { documentReviewsService } from "../../services/document-reviews";
import { useUserStore } from "../../stores/user-store";
import { ROUTES } from "../../constants/routes";
import { searchTargetId } from "../Search/helpers";
import "./index.less";

const statusLabels = {
  pending_review: "待审批",
  approved: "已通过",
  rejected: "已驳回",
} as const;
/** 将评审日期转换为本地可读时间，保留完整日期避免跨日歧义。 */
function time(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

/** 集中展示评审待办与提交时版本，通知可通过 reviewId 直接定位。 */
export default function ReviewsPage() {
  const [scope, setScope] = useState<DocumentReviewScope>("pending");
  const [params, setParams] = useSearchParams();
  const selectedId = searchTargetId(params.get("reviewId"));
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ["document-reviews", scope],
    queryFn: () => documentReviewsService.list(scope),
    refetchInterval: 30_000,
  });
  const detail = useQuery({
    queryKey: ["document-review", selectedId],
    queryFn: () => documentReviewsService.detail(selectedId!),
    enabled: Boolean(selectedId),
    retry: false,
    refetchInterval: 30_000,
  });

  /** 保留 URL 深链接，选择评审不触发隐式审批或改写其他筛选参数。 */
  function select(id: number) {
    const next = new URLSearchParams(params);
    next.set("reviewId", String(id));
    setParams(next);
  }

  return (
    <div className="workspace-page reviews-page">
      <div className="workspace-page-body reviews-page-content">
        <header className="workspace-page-header">
          <div className="workspace-page-heading">
            <span className="workspace-eyebrow">
              <ClipboardCheck size={14} /> 审批与协作
            </span>
            <h1 className="workspace-page-title">文档评审</h1>
            <p className="workspace-page-description">
              追踪提交版本、审批进度与后续任务，让每一次协作都有结论。
            </p>
          </div>
          <div className="reviews-header-actions">
            <Button
              icon={<RefreshCw size={15} />}
              loading={list.isFetching || detail.isFetching}
              onClick={() => {
                void list.refetch();
                if (selectedId) void detail.refetch();
              }}
            >
              刷新
            </Button>
            <Button
              type="primary"
              onClick={() => navigate(ROUTES.documents)}
              icon={<FileText size={16} />}
            >
              前往文档发起评审
            </Button>
          </div>
        </header>
        <section
          className="workspace-toolbar reviews-toolbar"
          aria-label="评审筛选"
        >
          <Segmented
            value={scope}
            onChange={(value) => setScope(value as DocumentReviewScope)}
            options={[
              { label: "待我审批", value: "pending" },
              { label: "我发起的", value: "submitted" },
              { label: "全部参与", value: "all" },
            ]}
          />
          <span className="reviews-toolbar-hint">
            提交版本留档 · 审批通过后自动建任务
          </span>
        </section>
        <div className="reviews-layout">
          <section
            aria-label="评审列表"
            className="workspace-panel reviews-list-panel"
            aria-busy={list.isLoading}
          >
            <div className="reviews-panel-heading">
              <h2>最近评审</h2>
              <span aria-live="polite">
                {list.isLoading
                  ? "正在同步"
                  : `${list.data?.length || 0} 条 · 最多 100 条`}
              </span>
            </div>
            {list.isError ? (
              <Alert
                type="error"
                showIcon
                title={list.error.message}
                action={
                  <Button onClick={() => void list.refetch()}>重试</Button>
                }
              />
            ) : list.isLoading ? (
              <div role="status" aria-label="正在加载评审列表">
                <Skeleton active />
              </div>
            ) : !list.data?.length ? (
              <Empty
                className="reviews-empty"
                image={<ClipboardCheck size={40} strokeWidth={1.4} />}
                description={
                  scope === "pending" ? "暂无待审批评审" : "暂无评审记录"
                }
              />
            ) : (
              <div className="reviews-list">
                {list.data.map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    selected={selectedId === review.id}
                    onSelect={() => select(review.id)}
                  />
                ))}
              </div>
            )}
          </section>
          <section
            aria-label="评审详情"
            className="workspace-panel reviews-detail-panel"
            aria-busy={Boolean(selectedId && detail.isLoading)}
          >
            {!selectedId ? (
              <Empty
                className="reviews-empty reviews-detail-empty"
                image={<FileCheck2 size={44} strokeWidth={1.3} />}
                description="选择评审查看提交版本和审批进度"
              />
            ) : detail.isError ? (
              <Alert
                type="error"
                showIcon
                title={detail.error.message}
                action={
                  <Button onClick={() => void detail.refetch()}>重试</Button>
                }
              />
            ) : detail.isLoading || !detail.data ? (
              <div role="status" aria-label="正在加载评审详情">
                <Skeleton active paragraph={{ rows: 8 }} />
              </div>
            ) : (
              <ReviewDetail
                key={detail.data.id}
                review={detail.data}
                refreshing={detail.isFetching}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** 使用可键盘操作的按钮卡片展示评审对象与状态。 */
function ReviewCard({
  review,
  selected,
  onSelect,
}: {
  review: DocumentReview;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`reviews-card ${selected ? "is-selected" : ""}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <strong className="break-words text-sm text-[var(--app-text)]">
          {review.title}
        </strong>
        <Tag className={`reviews-status reviews-status-${review.status}`}>
          {statusLabels[review.status]}
        </Tag>
      </div>
      <p className="mb-2 mt-0 break-words text-xs text-[var(--app-text-secondary)]">
        {review.documentTitle} · 版本 #{review.documentVersionId}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--app-text-secondary)]">
        <span>{review.submitter.name} 发起</span>
        <span>{review.approver.name} 审批</span>
      </div>
      <time
        dateTime={review.createdAt}
        className="mt-3 block text-xs text-[var(--app-text-secondary)]"
      >
        {time(review.createdAt)}
      </time>
    </button>
  );
}

/** 展示不可变提交版本，只让指定审批人在待审批状态下定案。 */
function ReviewDetail({
  review,
  refreshing,
}: {
  review: DocumentReviewDetail;
  refreshing: boolean;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const userId = useUserStore((state) => state.session?.user.id);
  const [comment, setComment] = useState("");
  const mounted = useRef(true);
  const requestKeys = useRef<{ approve?: string; reject?: string }>({});
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      documentReviewsService.decide(review.id, {
        decision,
        comment: comment.trim(),
        requestKey: (requestKeys.current[decision] ??= crypto.randomUUID()),
      }),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ["document-reviews"] });
      void client.invalidateQueries({
        queryKey: ["document-review", result.id],
      });
      void client.invalidateQueries({ queryKey: ["tasks"] });
      void client.invalidateQueries({ queryKey: ["notifications"] });
      if (mounted.current)
        message.success(
          result.status === "approved"
            ? "评审已通过，任务已自动创建"
            : "评审已驳回",
        );
    },
    onError: () => {
      void client.invalidateQueries({
        queryKey: ["document-review", review.id],
      });
    },
  });
  const canDecide =
    review.status === "pending_review" && review.approverId === userId;
  const disabled = decide.isPending || refreshing;

  return (
    <>
      <div className="reviews-detail-heading">
        <div>
          <h2 className="m-0 break-words text-lg font-semibold text-[var(--app-text)]">
            {review.title}
          </h2>
          <p className="mb-0 mt-1 text-xs text-[var(--app-text-secondary)]">
            评审 #{review.id} · {time(review.createdAt)}
          </p>
        </div>
        <Tag className={`reviews-status reviews-status-${review.status}`}>
          {statusLabels[review.status]}
        </Tag>
      </div>
      <dl className="reviews-facts">
        <div>
          <dt className="text-xs text-[var(--app-text-secondary)]">
            发起人 / 审批人
          </dt>
          <dd className="m-0 mt-1 text-[var(--app-text)]">
            {review.submitter.name} / {review.approver.name}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--app-text-secondary)]">
            任务负责人
          </dt>
          <dd className="m-0 mt-1 text-[var(--app-text)]">
            {review.assignee.name}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--app-text-secondary)]">关联群聊</dt>
          <dd className="m-0 mt-1 break-words text-[var(--app-text)]">
            {review.conversationName}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--app-text-secondary)]">
            任务截止时间
          </dt>
          <dd className="m-0 mt-1 text-[var(--app-text)]">
            {time(review.dueAt)}
          </dd>
        </div>
      </dl>
      <div className="reviews-version-heading">
        <h3 className="m-0 text-sm font-medium text-[var(--app-text)]">
          提交版本 · {review.version.title}
        </h3>
        <span className="shrink-0 text-xs text-[var(--app-text-secondary)]">
          #{review.documentVersionId}
        </span>
      </div>
      <p className="mt-0 text-xs text-[var(--app-text-secondary)]">
        此处为提交时的纯文本快照，不随当前文档的编辑变化。
      </p>
      <pre className="reviews-version-snapshot">
        {review.version.text || "（此版本暂无正文）"}
      </pre>
      {review.decidedAt && (
        <Alert
          className="mb-4"
          type={review.status === "approved" ? "success" : "warning"}
          showIcon
          title={`${review.approver.name}于 ${time(review.decidedAt)}${statusLabels[review.status]}`}
          description={review.decisionComment || "未填写审批意见"}
        />
      )}
      {review.taskId && (
        <Button
          onClick={() => navigate(`${ROUTES.tasks}?taskId=${review.taskId}`)}
        >
          查看自动创建的任务
        </Button>
      )}
      {canDecide && (
        <div className="reviews-decision-form">
          <label
            htmlFor={`review-comment-${review.id}`}
            className="mb-2 block text-sm text-[var(--app-text)]"
          >
            审批意见（可选）
          </label>
          <Input.TextArea
            id={`review-comment-${review.id}`}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={500}
            rows={3}
            disabled={disabled}
          />
          {decide.isError && (
            <Alert
              className="mt-3"
              type="error"
              showIcon
              title={decide.error.message}
              description="请确认当前评审状态后重试；失败不会重复创建任务。"
            />
          )}
          <div className="reviews-decision-actions">
            <Popconfirm
              title="驳回此评审？"
              description="驳回后不会创建任务，需要重新发起评审。"
              okText="确认驳回"
              cancelText="取消"
              disabled={disabled}
              onConfirm={() => decide.mutate("reject")}
            >
              <Button danger disabled={disabled}>
                驳回
              </Button>
            </Popconfirm>
            <Popconfirm
              title="通过此评审并创建任务？"
              description={`将为${review.assignee.name}创建任务，并通知关联群聊。`}
              okText="确认通过"
              cancelText="取消"
              disabled={disabled}
              onConfirm={() => decide.mutate("approve")}
            >
              <Button
                type="primary"
                disabled={disabled}
                loading={decide.isPending}
              >
                通过并建任务
              </Button>
            </Popconfirm>
          </div>
        </div>
      )}
      {review.status === "pending_review" && !canDecide && (
        <Alert
          type="info"
          showIcon
          title={`等待${review.approver.name}审批，只有指定审批人可操作。`}
        />
      )}
    </>
  );
}
