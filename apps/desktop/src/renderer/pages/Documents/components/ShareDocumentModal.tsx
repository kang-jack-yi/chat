import { useEffect, useMemo, useState } from "react";
import { Avatar, Modal, Select, Table, Tag, message } from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  CloudDocument,
  CloudDocumentPermission,
  User,
} from "@chat/shared";
import { organizationService } from "../../../services/organization";
import { documentsService } from "../../../services/documents";

interface ShareDocumentModalProps {
  document: CloudDocument | null;
  onClose: () => void;
  onSaved: () => void;
}

type EditablePermission = Exclude<CloudDocumentPermission, "owner">;

/** 配置文档协作者及权限，使用主题语义颜色保持成员头像清晰。 */
export default function ShareDocumentModal({
  document,
  onClose,
  onSaved,
}: ShareDocumentModalProps) {
  const users = useQuery({
    queryKey: ["document-share-users"],
    queryFn: organizationService.users,
    enabled: Boolean(document),
  });
  const [permissions, setPermissions] = useState<
    Record<number, EditablePermission>
  >({});

  useEffect(() => {
    if (!document) return;
    setPermissions(
      Object.fromEntries(
        document.members
          .filter((member) => member.permission !== "owner")
          .map((member) => [
            member.userId,
            member.permission as EditablePermission,
          ]),
      ),
    );
  }, [document]);

  const selectedUsers = useMemo(
    () => (users.data ?? []).filter((user) => permissions[user.id]),
    [permissions, users.data],
  );
  const save = useMutation({
    mutationFn: () =>
      documentsService.share(
        document!.id,
        Object.entries(permissions).map(([userId, permission]) => ({
          userId: Number(userId),
          permission,
        })),
      ),
    onSuccess: () => {
      message.success("共享设置已更新");
      onSaved();
      onClose();
    },
    onError: (error: Error) => message.error(error.message),
  });
  const owner = document?.members.find(
    (member) => member.permission === "owner",
  );

  return (
    <Modal
      title="共享文档"
      open={Boolean(document)}
      onCancel={onClose}
      onOk={() => save.mutate()}
      okText="保存共享设置"
      confirmLoading={save.isPending}
      width={620}
      destroyOnHidden
    >
      <div className="mb-4 rounded-xl bg-[var(--app-surface-soft)] p-3">
        <div className="mb-1 text-sm font-medium text-[var(--app-text)]">
          {document?.title}
        </div>
        <div className="text-xs text-[var(--app-text-secondary)]">
          所有者：{owner?.name || "我"} · 可邀请企业成员共同编辑或只读查看
        </div>
      </div>
      <Select
        mode="multiple"
        className="w-full"
        placeholder="搜索并添加协作成员"
        value={Object.keys(permissions).map(Number)}
        optionFilterProp="label"
        onChange={(ids: number[]) => {
          setPermissions((current) =>
            Object.fromEntries(ids.map((id) => [id, current[id] || "editor"])),
          );
        }}
        options={(users.data ?? [])
          .filter(
            (user) => user.id !== document?.ownerId && user.status === "active",
          )
          .map((user) => ({
            value: user.id,
            label: `${user.name} · ${user.departmentName || "未分配部门"}`,
          }))}
      />
      <Table<User>
        className="mt-4"
        size="small"
        rowKey="id"
        pagination={false}
        locale={{ emptyText: "暂未添加其他协作者" }}
        dataSource={selectedUsers}
        columns={[
          {
            title: "成员",
            render: (_, user) => (
              <span className="flex items-center gap-2">
                <Avatar
                  size={28}
                  style={{
                    backgroundColor: "var(--app-primary-soft)",
                    color: "var(--app-primary)",
                  }}
                >
                  {user.avatar || user.name.slice(0, 1)}
                </Avatar>
                <span>
                  <span className="block text-sm">{user.name}</span>
                  <small className="text-[var(--app-text-secondary)]">
                    {user.title || "成员"}
                  </small>
                </span>
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
                onChange={(permission: EditablePermission) =>
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
      <div className="mt-3 text-xs text-[var(--app-text-secondary)]">
        <Tag bordered={false} color="blue">
          实时协作
        </Tag>
        成员进入文档后可看到在线光标与编辑状态。
      </div>
    </Modal>
  );
}
