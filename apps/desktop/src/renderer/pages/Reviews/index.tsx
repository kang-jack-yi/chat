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
import { ClipboardCheck, FileText, RefreshCw } from "lucide-react";
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

const statusLabels = {
  pending_review: "待审批",
  approved: "已通过",
  rejected: "已驳回",
} as const;
const statusColors = {
  pending_review: "blue",
  approved: "green",
  rejected: "red",
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
    <div className="h-full overflow-y-auto bg-[var(--app-canvas)] px-[clamp(16px,3vw,48px)] py-7">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="m-0 flex items-center gap-2 text-2xl font-semibold text-[var(--app-text)]">
              <ClipboardCheck size={25} />
              文档评审
            </h1>
            <p className="mb-0 mt-2 text-sm text-[var(--app-text-secondary)]">
              提交文档 → 指定成员审批 → 自动建任务 → 到期提醒
            </p>
          </div>
          <div className="flex gap-2">
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
              onClick={() => navigate(ROUTES.documents)}
              icon={<FileText size={16} />}
            >
              前往文档发起评审
            </Button>
          </div>
        </header>
        <Segmented
          className="mb-5"
          value={scope}
          onChange={(value) => setScope(value as DocumentReviewScope)}
          options={[
            { label: "待我审批", value: "pending" },
            { label: "我发起的", value: "submitted" },
            { label: "全部参与", value: "all" },
          ]}
        />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.4fr)]">
          <section
            aria-label="评审列表"
            className="rounded-2xl border border-[var(--app-line)] bg-[var(--app-surface)] p-4 shadow-[var(--app-shadow-panel)]"
          >
            <div className="mb-4 flex items-center justify-between text-sm text-[var(--app-text-secondary)]">
              <span>最近评审</span>
              <span>{list.data?.length || 0} 条 · 最多 100 条</span>
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
              <Skeleton active />
            ) : !list.data?.length ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  scope === "pending" ? "暂无待审批评审" : "暂无评审记录"
                }
              />
            ) : (
              <div className="grid gap-3">
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
            className="min-w-0 rounded-2xl border border-[var(--app-line)] bg-[var(--app-surface)] p-5 shadow-[var(--app-shadow-panel)]"
          >
            {!selectedId ? (
              <Empty
                className="py-20"
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
              <Skeleton active paragraph={{ rows: 8 }} />
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
      className={`w-full cursor-pointer rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--app-primary)] ${selected ? "border-[var(--app-primary)] bg-[var(--app-primary-soft)]" : "border-[var(--app-line)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-soft)]"}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <strong className="break-words text-sm text-[var(--app-text)]">
          {review.title}
        </strong>
        <Tag className="!m-0 shrink-0" color={statusColors[review.status]}>
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
      <time className="mt-3 block text-xs text-[var(--app-text-tertiary)]">
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
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 break-words text-lg font-semibold text-[var(--app-text)]">
            {review.title}
          </h2>
          <p className="mb-0 mt-1 text-xs text-[var(--app-text-secondary)]">
            评审 #{review.id} · {time(review.createdAt)}
          </p>
        </div>
        <Tag className="shrink-0" color={statusColors[review.status]}>
          {statusLabels[review.status]}
        </Tag>
      </div>
      <dl className="mb-5 grid grid-cols-2 gap-x-5 gap-y-3 rounded-xl bg-[var(--app-surface-soft)] p-4 text-sm max-sm:grid-cols-1">
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
      <div className="mb-3 flex items-center justify-between gap-3">
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
      <pre className="mb-5 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--app-line)] bg-[var(--app-surface-soft)] p-4 font-sans text-sm leading-7 text-[var(--app-text)]">
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
        <div className="border-t border-[var(--app-line)] pt-4">
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
          <div className="mt-4 flex justify-end gap-2">
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
