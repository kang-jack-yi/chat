import { useEffect, useRef } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  message,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Dayjs } from "dayjs";
import type {
  CloudDocument,
  DocumentReview,
  SubmitDocumentReview,
} from "@chat/shared";
import { documentReviewsService } from "../../../services/document-reviews";

interface Props {
  document: CloudDocument | null;
  onClose: () => void;
  onSubmitted: (review: DocumentReview) => void;
}

interface Fields {
  title: string;
  conversationId: number;
  approverId: number;
  assigneeId: number;
  dueAt: Dayjs;
}

/** 按文档隔离表单实例，关闭或切换文档时不会继承旧草稿和请求回调。 */
export default function DocumentReviewModal({
  document,
  onClose,
  onSubmitted,
}: Props) {
  return document ? (
    <ReviewForm
      key={document.id}
      document={document}
      onClose={onClose}
      onSubmitted={onSubmitted}
    />
  ) : null;
}

/** 发起固定单人评审；只展示同时属于文档和群聊的有效参与者。 */
function ReviewForm({
  document,
  onClose,
  onSubmitted,
}: Props & { document: CloudDocument }) {
  const client = useQueryClient();
  const [form] = Form.useForm<Fields>();
  const conversationId = Form.useWatch("conversationId", form);
  const mounted = useRef(true);
  const attempt = useRef<{ fingerprint: string; requestKey: string } | null>(
    null,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const options = useQuery({
    queryKey: ["document-review-options", document.id],
    queryFn: () => documentReviewsService.options(document.id),
    staleTime: 0,
  });
  const group = options.data?.groups.find((item) => item.id === conversationId);
  const save = useMutation({
    mutationFn: documentReviewsService.submit,
    onSuccess: (review) => {
      void client.invalidateQueries({ queryKey: ["document-reviews"] });
      void client.invalidateQueries({
        queryKey: ["document-versions", review.documentId],
      });
      void client.invalidateQueries({ queryKey: ["notifications"] });
      if (mounted.current) {
        message.success("评审已提交，等待指定成员审批");
        onSubmitted(review);
      }
    },
  });

  /** 为内容未变的重试保留同一幂等键，不因超时重复创建审批。 */
  function submit(values: Fields) {
    const payload = {
      documentId: document.id,
      title: values.title.trim(),
      conversationId: values.conversationId,
      approverId: values.approverId,
      assigneeId: values.assigneeId,
      dueAt: values.dueAt.toISOString(),
    };
    const fingerprint = JSON.stringify(payload);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, requestKey: crypto.randomUUID() };
    const input: SubmitDocumentReview = {
      ...payload,
      requestKey: attempt.current.requestKey,
    };
    save.mutate(input);
  }

  return (
    <Modal
      open
      title="提交文档评审"
      onCancel={onClose}
      width={560}
      footer={null}
      maskClosable={!save.isPending}
      closable={!save.isPending}
      keyboard={!save.isPending}
    >
      <div className="mb-5 rounded-xl border border-[var(--app-line)] bg-[var(--app-surface-soft)] p-4">
        <strong className="block break-words text-sm text-[var(--app-text)]">
          {document.title}
        </strong>
        <p className="mb-0 mt-2 text-xs leading-5 text-[var(--app-text-secondary)]">
          提交时保存文档版本；审批通过后自动创建任务，到期后提醒负责人并通知关联群聊。
        </p>
      </div>
      {options.isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : options.isError ? (
        <Alert
          type="error"
          showIcon
          title={options.error.message}
          action={<Button onClick={() => void options.refetch()}>重试</Button>}
        />
      ) : !options.data?.groups.length ? (
        <Alert
          type="info"
          showIcon
          title="暂无可关联的群聊"
          description="请先加入企业群聊，并将文档共享给审批人和任务负责人。"
        />
      ) : (
        <Form
          form={form}
          layout="vertical"
          initialValues={{ title: `跟进：${document.title}`.slice(0, 180) }}
          onFinish={submit}
          disabled={save.isPending}
        >
          <Form.Item
            name="title"
            label="通过后创建的任务"
            rules={[
              { required: true, whitespace: true, message: "请输入任务标题" },
              { max: 180, message: "标题不能超过 180 个字符" },
            ]}
          >
            <Input maxLength={180} aria-label="任务标题" />
          </Form.Item>
          <Form.Item
            name="conversationId"
            label="关联群聊"
            rules={[{ required: true, message: "请选择群聊" }]}
          >
            <Select
              aria-label="关联群聊"
              placeholder="选择任务通知所在的群聊"
              options={options.data.groups.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              onChange={() =>
                form.setFieldsValue({
                  approverId: undefined,
                  assigneeId: undefined,
                })
              }
            />
          </Form.Item>
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1 max-sm:gap-0">
            <Form.Item
              name="approverId"
              label="指定审批人"
              rules={[{ required: true, message: "请选择审批人" }]}
            >
              <Select
                aria-label="指定审批人"
                placeholder="选择审批人"
                disabled={!group || save.isPending}
                showSearch
                optionFilterProp="label"
                options={group?.members.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="assigneeId"
              label="任务负责人"
              rules={[{ required: true, message: "请选择负责人" }]}
            >
              <Select
                aria-label="任务负责人"
                placeholder="选择负责人"
                disabled={!group || save.isPending}
                showSearch
                optionFilterProp="label"
                options={group?.members.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            </Form.Item>
          </div>
          <Form.Item
            name="dueAt"
            label="任务截止时间"
            rules={[{ required: true, message: "请选择截止时间" }]}
            extra="只显示已获得文档权限的群成员；若缺少成员，请先调整文档共享设置。"
          >
            <DatePicker aria-label="任务截止时间" showTime className="w-full" />
          </Form.Item>
          {save.isError && (
            <Alert
              className="mb-4"
              type="error"
              showIcon
              title={save.error.message}
              description="原表单已保留，可直接重试；同一请求不会重复创建评审。"
            />
          )}
          <div className="flex justify-end gap-2 border-t border-[var(--app-line)] pt-4">
            <Button onClick={onClose} disabled={save.isPending}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              提交评审
            </Button>
          </div>
        </Form>
      )}
    </Modal>
  );
}
