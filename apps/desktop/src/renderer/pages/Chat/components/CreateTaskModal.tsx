import { useEffect, useState } from "react";
import { DatePicker, Input, Modal, Select, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type { Message, TaskPriority, User } from "@chat/shared";
import { tasksService } from "../../../services/tasks";

interface CreateTaskModalProps {
  open: boolean;
  message: Message | null;
  users: User[];
  currentUserId: number;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateTaskModal({
  open,
  message: sourceMessage,
  users,
  currentUserId,
  onClose,
  onCreated,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueAt, setDueAt] = useState<Dayjs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(sourceMessage?.summary || "");
    setAssigneeId(currentUserId);
    setPriority("normal");
    setDueAt(null);
  }, [currentUserId, open, sourceMessage]);

  async function submit() {
    if (!title.trim() || !sourceMessage) return;
    setSaving(true);
    try {
      await tasksService.create({
        title: title.trim(),
        assigneeId,
        conversationId: sourceMessage.conversationId,
        messageId: sourceMessage.id,
        priority,
        dueAt: dueAt?.toISOString() || null,
      });
      message.success("任务已创建");
      onCreated();
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="从消息创建任务"
      onCancel={onClose}
      onOk={() => void submit()}
      okText="创建任务"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !title.trim() }}
    >
      <Input.TextArea
        value={title}
        maxLength={200}
        showCount
        rows={3}
        placeholder="任务标题"
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Select
          value={assigneeId}
          className="w-full"
          options={users
            .filter((user) => user.status === "active")
            .map((user) => ({ value: user.id, label: `负责人：${user.name}` }))}
          onChange={setAssigneeId}
        />
        <Select
          value={priority}
          className="w-full"
          options={[
            { value: "low", label: "优先级：低" },
            { value: "normal", label: "优先级：普通" },
            { value: "high", label: "优先级：高" },
            { value: "urgent", label: "优先级：紧急" },
          ]}
          onChange={setPriority}
        />
        <DatePicker
          className="w-full"
          showTime
          value={dueAt}
          placeholder="截止时间"
          onChange={setDueAt}
          disabledDate={(date) => date.isBefore(dayjs().startOf("day"))}
        />
      </div>
    </Modal>
  );
}
