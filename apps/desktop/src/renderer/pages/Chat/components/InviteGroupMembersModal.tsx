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
  Spin,
  Tree,
} from "antd";
import type { DataNode } from "antd/es/tree";
import { Building2, ChevronRight, Search, UsersRound, X } from "lucide-react";
import type { Conversation, Department, Message, User } from "@chat/shared";
import { queryKeys } from "../../../constants/query-keys";
import { chatService } from "../../../services/chat";
import { organizationService } from "../../../services/organization";
import "./invite-members.less";

export interface InviteGroupMembersModalProps {
  open: boolean;
  conversation: Conversation;
  users: User[];
  onClose: () => void;
  onSuccess?: () => void;
}

/** 为成员生成独立于部门节点的勾选标识。 */
function userKey(userId: number) {
  return `user:${userId}`;
}

/** 为部门生成可级联选择的树节点标识。 */
function departmentKey(departmentId: number) {
  return `department:${departmentId}`;
}

/** 按部门组织可邀请成员，并保留已有成员的只读勾选状态。 */
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
      <span className="invite-member-person">
        <Avatar
          shape="square"
          size={28}
          src={user.avatarUrl}
          className="invite-member-avatar"
        >
          {user.avatar || user.name.slice(0, 1)}
        </Avatar>
        <span className="invite-member-person-copy">
          <strong title={user.name}>{user.name}</strong>
          {user.title && <small title={user.title}>{user.title}</small>}
        </span>
        {existingMemberIds.has(user.id) && (
          <small className="invite-member-existing">已在群聊</small>
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
      title: (
        <span className="text-xs text-[var(--app-text-secondary)]">
          未分配部门
        </span>
      ),
      children: unassigned,
    });
  }
  return roots;
}

/** 提供企业成员选择、已选预览和可选的入群聊天记录。 */
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
  // 搜索会隐藏部分节点，树控件只接收当前可见的勾选项。
  const visibleUserIds = useMemo(() => {
    const ids = new Set<number>();
    const pending = [...treeData];
    while (pending.length) {
      const node = pending.pop()!;
      const key = String(node.key);
      if (key.startsWith("user:")) ids.add(Number(key.slice(5)));
      if (node.children) pending.push(...node.children);
    }
    return ids;
  }, [treeData]);
  const checkedKeys = useMemo(
    () =>
      [...existingMemberIds, ...selectedIds]
        .filter((id) => visibleUserIds.has(id))
        .map(userKey),
    [existingMemberIds, selectedIds, visibleUserIds],
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

  /** 打开桌面独立窗口，确认后回填需要附带的消息。 */
  async function openHistorySelection(defaultSelectAll: boolean) {
    if (!window.desktop?.windows) {
      setError("请在桌面客户端中选择聊天记录");
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

  /** 勾选附带记录时读取最近可分享的普通消息。 */
  async function selectRecentHistory() {
    if (!window.desktop?.windows) {
      setError("请在桌面客户端中附带聊天记录");
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

  /** 从级联勾选结果中提取尚未入群的成员。 */
  function handleTreeCheck(keys: Key[] | { checked: Key[] }) {
    const checked = Array.isArray(keys) ? keys : keys.checked;
    const checkedIds = checked
      .map(String)
      .filter((key) => key.startsWith("user:"))
      .map((key) => Number(key.slice(5)))
      .filter((id) => !existingMemberIds.has(id));
    // 只更新本次筛选中的成员，保留用户在其他搜索结果里做出的选择。
    setSelectedIds((current) => [
      ...new Set([
        ...current.filter((id) => !visibleUserIds.has(id)),
        ...checkedIds,
      ]),
    ]);
  }

  return (
    <Modal
      open={open}
      className="invite-members-modal"
      title={
        <span className="invite-members-title">
          <span className="invite-members-title-icon">
            <UsersRound size={20} strokeWidth={1.8} />
          </span>
          <span className="invite-members-title-copy">
            <strong>添加群成员</strong>
            <small>从企业通讯录中选择要邀请的新成员</small>
          </span>
        </span>
      }
      width={860}
      centered
      destroyOnHidden
      onCancel={onClose}
      footer={
        <div className="invite-members-footer">
          <div className="invite-members-history">
            <Checkbox
              aria-label="附带最近聊天记录"
              checked={includeHistory}
              disabled={historyOpening || invite.isPending}
              onChange={(event) => {
                if (!event.target.checked) {
                  setIncludeHistory(false);
                  setSelectedHistoryIds([]);
                  return;
                }
                void selectRecentHistory();
              }}
            />
            <span className="invite-members-history-copy">
              <strong>
                {historyOpening ? "正在读取聊天记录…" : "附带最近聊天记录"}
                {includeHistory && selectedHistoryIds.length > 0 && (
                  <em>{selectedHistoryIds.length} 条</em>
                )}
              </strong>
              <small>
                可选，从最近 30 条普通消息中选择，供新成员入群后查看
              </small>
            </span>
            <Button
              type="text"
              aria-label="选择附带的聊天记录"
              className="invite-members-history-select"
              disabled={historyOpening || invite.isPending}
              onClick={() =>
                void openHistorySelection(selectedHistoryIds.length === 0)
              }
            >
              选择记录
              <ChevronRight size={14} />
            </Button>
          </div>
          <div className="invite-members-actions">
            <span className="invite-members-selection-hint" aria-live="polite">
              已选择 <strong>{selectedIds.length}</strong> 位新成员
            </span>
            <span className="invite-members-action-buttons">
              <Button onClick={onClose}>取消</Button>
              <Button
                type="primary"
                loading={invite.isPending}
                disabled={!selectedIds.length || historyOpening}
                onClick={() => invite.mutate()}
              >
                邀请{selectedIds.length ? ` ${selectedIds.length} 人` : "成员"}
              </Button>
            </span>
          </div>
        </div>
      }
    >
      {error && (
        <Alert
          type="error"
          title={error}
          closable
          className="!mb-3"
          onClose={() => setError("")}
        />
      )}
      <div className="invite-members-layout">
        <section className="invite-members-directory" aria-label="企业通讯录">
          <div className="invite-members-directory-header">
            <label htmlFor={`invite-member-search-${conversation.id}`}>
              <Building2 size={15} className="text-[var(--app-primary)]" />
              企业通讯录
            </label>
            <Input
              id={`invite-member-search-${conversation.id}`}
              aria-label="搜索企业成员"
              allowClear
              value={keyword}
              prefix={<Search size={15} />}
              placeholder="搜索姓名、手机号、职位或部门"
              size="middle"
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
          <div className="invite-members-directory-list">
            {departments.isLoading ? (
              <div className="invite-members-loading" role="status">
                <Spin size="small" />
                正在加载通讯录
              </div>
            ) : departments.isError ? (
              <div className="invite-members-directory-error" role="alert">
                <p>通讯录加载失败</p>
                <Button onClick={() => void departments.refetch()}>
                  重新加载
                </Button>
              </div>
            ) : !treeData.length ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="没有匹配的企业成员"
                className="invite-members-directory-empty"
              />
            ) : (
              <Tree
                key={`${conversation.id}:${keyword}:${departments.data?.length ?? 0}`}
                blockNode
                checkable
                defaultExpandAll
                disabled={invite.isPending}
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
        <section className="invite-members-selection" aria-label="已选择成员">
          <div className="invite-members-selection-header">
            <h3>
              <span className="grid gap-0.5">
                <span>已选择成员</span>
                <small className="text-xs font-normal text-[var(--app-text-tertiary)]">
                  确认后加入「{conversation.name}」
                </small>
              </span>
              <span className="invite-members-selection-count">
                {selectedUsers.length}
              </span>
            </h3>
          </div>
          <div className="invite-members-selected-list">
            {!selectedUsers.length && (
              <div className="invite-members-selected-empty">
                <UsersRound size={28} aria-hidden="true" />
                <p>选择的成员会显示在这里</p>
              </div>
            )}
            {selectedUsers.map((user) => (
              <div key={user.id} className="invite-members-selected-person">
                <Avatar
                  shape="square"
                  size={32}
                  src={user.avatarUrl}
                  className="invite-member-avatar"
                >
                  {user.avatar || user.name.slice(0, 1)}
                </Avatar>
                <span
                  className="invite-members-selected-name"
                  title={user.name}
                >
                  {user.name}
                </span>
                <Button
                  type="text"
                  size="small"
                  aria-label={`移除${user.name}`}
                  icon={<X size={14} />}
                  disabled={invite.isPending}
                  className="invite-members-remove"
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
