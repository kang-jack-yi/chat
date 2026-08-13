import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, Avatar as AntAvatar, Button, Checkbox, Input, List, Modal } from "antd";
import type { Conversation, User } from "@chat/shared";
import { chatService } from "../../../services/chat";

export interface GroupDialogProps {
  open: boolean;
  users: User[];
  onClose: () => void;
  onCreated: (conversation: Conversation) => void;
}

export default function GroupDialog({ open, users, onClose, onCreated }: GroupDialogProps) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => chatService.createGroup(name.trim(), selected),
    onSuccess: onCreated,
    onError: (reason: Error) => setError(reason.message),
  });

  return (
    <Modal
      open={open}
      title="发起群聊"
      onCancel={onClose}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">已选择 {selected.length} 人</span>
          <div className="flex gap-2">
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" disabled={!name.trim() || selected.length < 1} loading={mutation.isPending} onClick={() => mutation.mutate()}>
              创建群聊
            </Button>
          </div>
        </div>
      }
    >
      <p className="-mt-2 mb-4 text-xs text-slate-400">选择同事并设置一个容易识别的群名称</p>
      <label className="mb-4 grid gap-2 text-sm font-semibold text-[var(--app-text)]">
        群聊名称
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：产品体验优化群" />
      </label>
      <List
        bordered
        className="max-h-80 overflow-y-auto !rounded-xl !border-[var(--app-line)]"
        dataSource={users}
        renderItem={(user) => {
          const checked = selected.includes(user.id);
          return (
            <List.Item
              className="cursor-pointer hover:!bg-[var(--app-primary-soft)]"
              onClick={() => setSelected(checked ? selected.filter((id) => id !== user.id) : [...selected, user.id])}
            >
              <div className="flex items-center gap-3">
                <Checkbox checked={checked} />
                <AntAvatar shape="square" className="!rounded-lg" style={{ backgroundColor: "#4b8fea" }}>{user.avatar}</AntAvatar>
                <span className="grid gap-0.5"><strong>{user.name}</strong><small className="text-slate-400">{user.departmentName} · {user.title}</small></span>
              </div>
            </List.Item>
          );
        }}
      />
      {error && <Alert className="mt-3" type="error" message={error} showIcon />}
    </Modal>
  );
}
