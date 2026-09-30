import { useEffect, useMemo, useState, type Key } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Tree,
} from "antd";
import type { DataNode } from "antd/es/tree";
import { Building2, ChevronRight, Search, UsersRound, X } from "lucide-react";
import type { Conversation, Department, Message, User } from "@chat/shared";
import { queryKeys } from "../../../constants/query-keys";
import { chatService } from "../../../services/chat";
import { organizationService } from "../../../services/organization";

export interface InviteGroupMembersModalProps {
  open: boolean;
  conversation: Conversation;
  users: User[];
  onClose: () => void;
  onSuccess?: () => void;
}

function userKey(userId: number) {
  return `user:${userId}`;
}

function departmentKey(departmentId: number) {
  return `department:${departmentId}`;
}

function createDepartmentTree(
  departments: Department[],
  users: User[],
  existingMemberIds: Set<number>,
  keyword: string,
): DataNode[] {
  const normalized = keyword.trim().toLocaleLowerCase();
  const visibleUsers = users.filter((user) => {
    if (user.status !== "active" && !existingMemberIds.has(user.id))
      return false;
    if (!normalized) return true;
    return [user.name, user.phone, user.title, user.departmentName].some(
      (value) =>
        String(value || "")
          .toLocaleLowerCase()
          .includes(normalized),
    );
  });
  const usersByDepartment = new Map<number | null, User[]>();
  for (const user of visibleUsers) {
    const departmentId = user.departmentId ?? null;
    usersByDepartment.set(departmentId, [
      ...(usersByDepartment.get(departmentId) ?? []),
      user,
    ]);
  }
  const childrenByParent = new Map<number | null, Department[]>();
  for (const department of departments) {
    childrenByParent.set(department.parentId, [
      ...(childrenByParent.get(department.parentId) ?? []),
      department,
    ]);
  }

  const userNode = (user: User): DataNode => ({
    key: userKey(user.id),
    title: (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar
          shape="square"
          size={28}
          className="!rounded-lg !bg-[var(--app-primary)] !text-xs"
        >
          {user.avatar || user.name.slice(0, 1)}
        </Avatar>
        <span className="min-w-0 truncate text-sm text-[var(--app-text)]">
          {user.name}
        </span>
        {existingMemberIds.has(user.id) && (
          <small className="shrink-0 text-xs text-[var(--app-text-tertiary)]">
            已在群聊
          </small>
        )}
      </span>
    ),
    isLeaf: true,
    disabled: existingMemberIds.has(user.id),
  });

  const buildDepartments = (parentId: number | null): DataNode[] =>
    (childrenByParent.get(parentId) ?? [])
      .sort(
        (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
      )
      .map((department) => {
        const children = [
          ...buildDepartments(department.id),
          ...(usersByDepartment.get(department.id) ?? [])
            .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
            .map(userNode),
        ];
        return {
          key: departmentKey(department.id),
          title: (
            <span className="text-sm font-medium text-[var(--app-text)]">
              {department.name}
            </span>
          ),
          children,
        };
      })
      .filter((node) => !normalized || Boolean(node.children?.length));

  const roots = buildDepartments(null);
  const unassigned = (usersByDepartment.get(null) ?? []).map(userNode);
  if (unassigned.length) {
    roots.push({
      key: "department:unassigned",
      title: <span className="text-xs text-slate-500">未分配部门</span>,
      children: unassigned,
    });
  }
  return roots;
}

export default function InviteGroupMembersModal({
  open,
  conversation,
  users,
  onClose,
  onSuccess,
}: InviteGroupMembersModalProps) {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<number[]>([]);
  const [historyOpening, setHistoryOpening] = useState(false);
  const [error, setError] = useState("");
  const existingMemberIds = useMemo(
    () => new Set((conversation.members ?? []).map((member) => member.id)),
    [conversation.members],
  );
  const departments = useQuery({
    queryKey: queryKeys.departments,
    queryFn: organizationService.departments,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setKeyword("");
    setSelectedIds([]);
    setIncludeHistory(false);
    setSelectedHistoryIds([]);
    setHistoryOpening(false);
    setError("");
  }, [conversation.id, open]);

  const treeData = useMemo(
    () =>
      createDepartmentTree(
        departments.data ?? [],
        users,
        existingMemberIds,
        keyword,
      ),
    [departments.data, existingMemberIds, keyword, users],
  );
  const selectedUsers = useMemo(() => {
    const selected = new Set(selectedIds);
    return users.filter((user) => selected.has(user.id));
  }, [selectedIds, users]);
  const checkedKeys = useMemo(
    () => [...[...existingMemberIds].map(userKey), ...selectedIds.map(userKey)],
    [existingMemberIds, selectedIds],
  );

  const invite = useMutation({
    mutationFn: () =>
      chatService.addMembers(
        conversation.id,
        selectedIds,
        includeHistory ? selectedHistoryIds : [],
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.messages(conversation.id),
        }),
      ]);
      onSuccess?.();
      onClose();
    },
    onError: (reason: Error) => setError(reason.message),
  });

  async function openHistorySelection(defaultSelectAll: boolean) {
    if (!window.desktop?.windows) {
      setError("当前客户端不支持独立聊天记录选择窗口");
      if (defaultSelectAll) setIncludeHistory(false);
      return;
    }
    setHistoryOpening(true);
    setError("");
    try {
      const result = await window.desktop.windows.openInviteHistory({
        conversationId: conversation.id,
        selectedMessageIds: selectedHistoryIds,
        defaultSelectAll,
      });
      if (!result.confirmed) {
        if (defaultSelectAll && selectedHistoryIds.length === 0) {
          setIncludeHistory(false);
        }
        return;
      }
      setSelectedHistoryIds(result.selectedMessageIds);
      setIncludeHistory(result.selectedCount > 0);
    } catch (reason) {
      if (defaultSelectAll && selectedHistoryIds.length === 0) {
        setIncludeHistory(false);
      }
      setError(
        reason instanceof Error ? reason.message : "打开聊天记录选择窗口失败",
      );
    } finally {
      setHistoryOpening(false);
    }
  }

  async function selectRecentHistory() {
    if (!window.desktop?.windows) {
      setError("当前客户端不支持本地聊天记录");
      setIncludeHistory(false);
      return;
    }
    setHistoryOpening(true);
    setError("");
    try {
      const getRecentIds = window.desktop.windows.getRecentInviteHistoryIds;
      const messageIds =
        typeof getRecentIds === "function"
          ? await getRecentIds(conversation.id)
          : await window.desktop.im
              .call<Message[]>("getRecentUserMessages", {
                conversationId: conversation.id,
                limit: 30,
              })
              .then((messages) => messages.map((message) => message.id));
      setSelectedHistoryIds(messageIds);
      setIncludeHistory(messageIds.length > 0);
      if (!messageIds.length) {
        setError("当前会话暂无可附带的普通消息");
      }
    } catch (reason) {
      setIncludeHistory(false);
      setSelectedHistoryIds([]);
      setError(
        reason instanceof Error ? reason.message : "读取本地聊天记录失败",
      );
    } finally {
      setHistoryOpening(false);
    }
  }

  function handleTreeCheck(keys: Key[] | { checked: Key[] }) {
    const checked = Array.isArray(keys) ? keys : keys.checked;
    setSelectedIds(
      checked
        .map(String)
        .filter((key) => key.startsWith("user:"))
        .map((key) => Number(key.slice(5)))
        .filter((id) => !existingMemberIds.has(id)),
    );
  }

  return (
    <Modal
      open={open}
      className="invite-members-modal"
      title={
        <span className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--app-primary-soft)] text-[var(--app-primary)]">
            <UsersRound size={20} strokeWidth={1.8} />
          </span>
          <span className="grid gap-0.5">
            <strong className="text-sm font-semibold text-[var(--app-text)]">
              添加群成员
            </strong>
            <small className="text-xs font-normal text-slate-400">
              从企业通讯录中选择要邀请的新成员
            </small>
          </span>
        </span>
      }
      width={840}
      centered
      destroyOnHidden
      onCancel={onClose}
      footer={
        <div className="flex items-center justify-between gap-4 px-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <Checkbox
              checked={includeHistory}
              disabled={historyOpening}
              onChange={(event) => {
                if (!event.target.checked) {
                  setIncludeHistory(false);
                  setSelectedHistoryIds([]);
                  return;
                }
                void selectRecentHistory();
              }}
            />
            <button
              type="button"
              className="flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-1.5 text-left text-sm text-[var(--app-text-secondary)] transition-colors hover:text-[var(--app-primary)] disabled:text-[var(--app-text-tertiary)]"
              disabled={historyOpening}
              onClick={() =>
                void openHistorySelection(selectedHistoryIds.length === 0)
              }
            >
              <span>
                {historyOpening ? "正在读取聊天记录…" : "附带最近聊天记录"}
              </span>
              <ChevronRight size={14} />
            </button>
            {includeHistory && selectedHistoryIds.length > 0 && (
              <span className="rounded-full bg-[var(--app-primary-soft)] px-2 py-0.5 text-xs font-medium text-[var(--app-primary)]">
                {selectedHistoryIds.length} 条
              </span>
            )}
          </span>
          <span className="flex shrink-0 gap-2">
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              loading={invite.isPending}
              disabled={!selectedIds.length}
              onClick={() => invite.mutate()}
            >
              确定{selectedIds.length ? `（${selectedIds.length}）` : ""}
            </Button>
          </span>
        </div>
      }
    >
      {error && (
        <Alert
          type="error"
          message={error}
          closable
          className="!mb-3"
          onClose={() => setError("")}
        />
      )}
      <div className="grid h-[456px] grid-cols-[minmax(0,1fr)_288px] overflow-hidden rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] shadow-[var(--app-shadow-panel)]">
        <section className="grid min-h-0 min-w-0 grid-rows-[72px_minmax(0,1fr)] border-r border-[var(--app-line)]">
          <div className="grid h-[72px] gap-2 border-b border-[var(--app-line)] bg-[var(--app-surface)] px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-medium text-[var(--app-text-secondary)]">
              <Building2 size={15} className="text-[var(--app-primary)]" />
              企业通讯录
            </span>
            <Input
              allowClear
              value={keyword}
              prefix={<Search size={15} className="text-slate-400" />}
              placeholder="搜索姓名、手机号、职位或部门"
              size="middle"
              className="!rounded-lg !border-[var(--app-line)] !bg-[var(--app-surface-soft)]"
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
          <div className="min-h-0 overflow-y-auto bg-[var(--app-surface-soft)] px-3 py-3">
            {!treeData.length ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="没有匹配的企业成员"
                className="!my-16"
              />
            ) : (
              <Tree
                key={`${conversation.id}:${keyword}:${departments.data?.length ?? 0}`}
                blockNode
                checkable
                defaultExpandAll
                checkedKeys={checkedKeys}
                treeData={treeData}
                className="invite-member-tree !bg-transparent"
                onCheck={(keys) =>
                  handleTreeCheck(keys as Key[] | { checked: Key[] })
                }
              />
            )}
          </div>
        </section>
        <section className="grid min-h-0 min-w-0 grid-rows-[72px_minmax(0,1fr)] bg-[var(--app-surface-soft)]">
          <div className="flex h-[72px] items-center border-b border-[var(--app-line)] bg-[var(--app-surface)] px-4">
            <h3 className="m-0 flex w-full items-center justify-between text-sm font-medium text-[var(--app-text)]">
              <span className="grid gap-0.5">
                <span>已选择成员</span>
                <small className="text-xs font-normal text-[var(--app-text-tertiary)]">
                  确认后将邀请加入当前群聊
                </small>
              </span>
              <span className="rounded-full bg-[var(--app-primary-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--app-primary)]">
                {selectedUsers.length}
              </span>
            </h3>
          </div>
          <div className="min-h-0 overflow-y-auto px-3 py-3">
            {!selectedUsers.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="从左侧选择新成员"
                className="!my-16"
              />
            )}
            {selectedUsers.map((user) => (
              <div
                key={user.id}
                className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--app-line)] bg-[var(--app-surface)] px-3 py-2 shadow-[var(--app-shadow-panel)]"
              >
                <Avatar
                  shape="square"
                  size={32}
                  className="!rounded-lg !bg-[var(--app-primary)]"
                >
                  {user.avatar || user.name.slice(0, 1)}
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-text)]">
                  {user.name}
                </span>
                <Button
                  type="text"
                  size="small"
                  aria-label={`移除${user.name}`}
                  icon={<X size={14} />}
                  className="!text-[var(--app-text-tertiary)] hover:!bg-[var(--app-surface-muted)]"
                  onClick={() =>
                    setSelectedIds((current) =>
                      current.filter((id) => id !== user.id),
                    )
                  }
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
