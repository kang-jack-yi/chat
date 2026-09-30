import { useEffect, useState } from "react";
import { Avatar, Modal, Select, Table, message } from "antd";
import type {
  CloudDocument,
  CloudDocumentPermission,
  User,
} from "@chat/shared";
import { documentApi } from "./api";

interface ShareModalProps {
  document: CloudDocument;
  open: boolean;
  onClose: () => void;
  onChange: (document: CloudDocument) => void;
}

type Permission = Exclude<CloudDocumentPermission, "owner">;

export default function ShareModal({
  document,
  open,
  onClose,
  onChange,
}: ShareModalProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<Record<number, Permission>>(
    {},
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPermissions(
      Object.fromEntries(
        document.members
          .filter((member) => member.permission !== "owner")
          .map((member) => [member.userId, member.permission as Permission]),
      ),
    );
    void documentApi
      .users()
      .then(setUsers)
      .catch((error: Error) => message.error(error.message));
  }, [document, open]);

  const selected = users.filter((user) => permissions[user.id]);
  async function save() {
    setSaving(true);
    try {
      const updated = await documentApi.share(
        document.id,
        Object.entries(permissions).map(([userId, permission]) => ({
          userId: Number(userId),
          permission,
        })),
      );
      onChange(updated);
      message.success("共享设置已保存");
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="共享文档"
      open={open}
      onCancel={onClose}
      onOk={save}
      okText="保存"
      confirmLoading={saving}
      width={620}
    >
      <Select
        mode="multiple"
        className="w-full"
        placeholder="添加企业协作成员"
        value={Object.keys(permissions).map(Number)}
        onChange={(ids: number[]) =>
          setPermissions((current) =>
            Object.fromEntries(ids.map((id) => [id, current[id] || "editor"])),
          )
        }
        options={users
          .filter(
            (user) => user.id !== document.ownerId && user.status === "active",
          )
          .map((user) => ({
            value: user.id,
            label: `${user.name} · ${user.title || "成员"}`,
          }))}
      />
      <Table<User>
        rowKey="id"
        size="small"
        className="mt-4"
        pagination={false}
        dataSource={selected}
        locale={{ emptyText: "暂未添加其他协作者" }}
        columns={[
          {
            title: "协作者",
            render: (_, user) => (
              <span className="flex items-center gap-2">
                <Avatar size={28}>
                  {user.avatar || user.name.slice(0, 1)}
                </Avatar>
                <span>{user.name}</span>
              </span>
            ),
          },
          {
            title: "权限",
            width: 140,
            render: (_, user) => (
              <Select
                size="small"
                value={permissions[user.id]}
                onChange={(permission: Permission) =>
                  setPermissions((current) => ({
                    ...current,
                    [user.id]: permission,
                  }))
                }
                options={[
                  { value: "editor", label: "可编辑" },
                  { value: "viewer", label: "仅查看" },
                ]}
              />
            ),
          },
        ]}
      />
    </Modal>
  );
}
