import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Alert, Button, Input, Modal, Popconfirm, Select, Switch } from "antd";
import {
  BellOff,
  Bot,
  ChevronRight,
  Crown,
  LogOut,
  Pin,
  Trash2,
} from "lucide-react";
import type { Conversation, Message, User } from "@chat/shared";
import { queryKeys } from "../../../constants/query-keys";
import { chatService } from "../../../services/chat";
import { localDatabase } from "../../../services/local-database";
import type { MessagePage } from "../../../types/api";
import ConversationBotsModal from "./ConversationBotsModal";
import GroupAnnouncementModal from "./GroupAnnouncementModal";

export interface ConversationSettingsModalProps {
  open: boolean;
  conversation: Conversation;
  currentUser: User;
  onClose: () => void;
  onRemoved: () => void;
}

type GroupAction =
  | { type: "leave" }
  | { type: "dissolve" }
  | { type: "transfer"; userId: number };

export default function ConversationSettingsModal({
  open,
  conversation,
  currentUser,
  onClose,
  onRemoved,
}: ConversationSettingsModalProps) {
  const queryClient = useQueryClient();
  const [groupName, setGroupName] = useState(conversation.name);
  const [newOwnerId, setNewOwnerId] = useState<number>();
  const [nameOpen, setNameOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [botsOpen, setBotsOpen] = useState(false);
  const [error, setError] = useState("");
  const isGroup = conversation.type === "group";
  const isOwner = isGroup && conversation.createdBy === currentUser.id;

  const ownerOptions = useMemo(
    () =>
      (conversation.members ?? [])
        .filter(
          (member) =>
            member.id !== currentUser.id && member.status === "active",
        )
        .map((member) => ({
          value: member.id,
          label: `${member.name}${member.title ? ` · ${member.title}` : ""}`,
        })),
    [conversation.members, currentUser.id],
  );

  useEffect(() => {
    if (!open) return;
    setGroupName(conversation.name);
    setNewOwnerId(undefined);
    setNameOpen(false);
    setAnnouncementOpen(false);
    setTransferOpen(false);
    setBotsOpen(false);
    setError("");
  }, [conversation.id, conversation.name, open]);

  const refreshConversation = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
  const settingMutation = useMutation({
    mutationFn: (payload: {
      pinned?: boolean;
      muted?: boolean;
      clearHistory?: boolean;
    }) => chatService.settings(conversation.id, payload),
    onSuccess: async (_data, payload) => {
      await refreshConversation();
      if (payload.clearHistory) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.messages(conversation.id),
        });
      }
    },
    onError: (reason: Error) => setError(reason.message),
  });
  const groupUpdateMutation = useMutation({
    mutationFn: (payload: { name: string }) =>
      chatService.updateGroup(conversation.id, payload),
    onSuccess: async () => {
      await refreshConversation();
      setNameOpen(false);
    },
    onError: (reason: Error) => setError(reason.message),
  });
  const groupActionMutation = useMutation<
    boolean | Conversation,
    Error,
    GroupAction
  >({
    mutationFn: (action) => {
      if (action.type === "leave")
        return chatService.removeMember(conversation.id, currentUser.id);
      if (action.type === "dissolve")
        return chatService.dissolveGroup(conversation.id);
      return chatService.transferOwner(conversation.id, action.userId);
    },
    onSuccess: async (_data, action) => {
      await refreshConversation();
      if (action.type === "transfer") {
        setTransferOpen(false);
        setNewOwnerId(undefined);
      } else {
        onClose();
        onRemoved();
      }
    },
    onError: (reason) => setError(reason.message),
  });

  const rowClass =
    "flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--app-surface-muted)]";
  const cardClass =
    "overflow-hidden rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)]";

  return (
    <>
      <Modal
        open={open}
        title={isGroup ? "群聊设置" : "聊天设置"}
        width={420}
        wrapClassName="conversation-settings-modal-wrap"
        className="conversation-settings-modal"
        style={{
          top: 0,
          height: "100%",
          maxWidth: "100vw",
          margin: "0 0 0 auto",
          paddingBottom: 0,
        }}
        styles={{
          wrapper: { overflow: "hidden" },
          container: {
            display: "flex",
            height: "100vh",
            padding: 0,
            flexDirection: "column",
            overflow: "hidden",
            border: 0,
            borderLeft: "1px solid var(--app-line)",
            borderRadius: "8px 0 0 8px",
            background: "var(--app-canvas)",
          },
          header: {
            flex: "0 0 auto",
            margin: 0,
            padding: "18px 20px",
            borderBottom: "1px solid var(--app-line)",
            background: "var(--app-surface)",
          },
          body: {
            minHeight: 0,
            padding: 16,
            flex: 1,
            overflowY: "auto",
            background: "var(--app-canvas)",
          },
        }}
        footer={null}
        onCancel={onClose}
        destroyOnHidden
      >
        {error && (
          <Alert
            className="mb-3"
            type="error"
            message={error}
            closable
            onClose={() => setError("")}
          />
        )}

        {isGroup && (
          <div className={`${cardClass} mb-3`}>
            <button
              type="button"
              className={`${rowClass} border-b border-[var(--app-line)]`}
              onClick={() => setNameOpen(true)}
            >
              <span className="min-w-0">
                <strong className="block text-sm font-medium text-[var(--app-text)]">
                  群聊名称
                </strong>
                <small className="mt-1 block truncate text-xs text-[var(--app-text-tertiary)]">
                  {conversation.name}
                </small>
              </span>
              <ChevronRight
                size={17}
                className="text-[var(--app-text-tertiary)]"
              />
            </button>
            <button
              type="button"
              className={rowClass}
              onClick={() => setAnnouncementOpen(true)}
            >
              <span className="min-w-0">
                <strong className="block text-sm font-medium text-[var(--app-text)]">
                  群公告
                </strong>
                <small className="mt-1 block truncate text-xs text-[var(--app-text-tertiary)]">
                  {conversation.announcement || "未设置"}
                </small>
              </span>
              <ChevronRight
                size={17}
                className="text-[var(--app-text-tertiary)]"
              />
            </button>
          </div>
        )}

        <div className="mb-4">
          <button
            type="button"
            className={`${rowClass} group rounded-xl border border-[var(--app-line)] bg-[var(--app-surface-soft)]`}
            onClick={() => setBotsOpen(true)}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--app-primary-soft)] text-[var(--app-primary)]">
                <Bot size={18} />
              </span>
              <span className="min-w-0">
                <strong className="block text-sm text-[var(--app-text)]">
                  {isGroup ? "群机器人" : "会话机器人"}
                </strong>
                <small className="mt-0.5 block truncate text-xs text-[var(--app-text-tertiary)]">
                  通过 Webhook 向当前{isGroup ? "群聊" : "会话"}推送消息
                </small>
              </span>
            </span>
            <ChevronRight
              size={17}
              className="text-[var(--app-text-tertiary)]"
            />
          </button>
        </div>

        <div className={cardClass}>
          <div className={`${rowClass} border-b border-[var(--app-line)]`}>
            <span className="flex items-center gap-3 text-sm text-[var(--app-text)]">
              <Pin size={17} />
              置顶聊天
            </span>
            <Switch
              checked={Boolean(conversation.pinned)}
              loading={settingMutation.isPending}
              onChange={(pinned) => settingMutation.mutate({ pinned })}
            />
          </div>
          <div className={`${rowClass} border-b border-[var(--app-line)]`}>
            <span className="flex items-center gap-3 text-sm text-[var(--app-text)]">
              <BellOff size={17} />
              消息免打扰
            </span>
            <Switch
              checked={Boolean(conversation.muted)}
              loading={settingMutation.isPending}
              onChange={(muted) => settingMutation.mutate({ muted })}
            />
          </div>
          <div className={rowClass}>
            <span>
              <strong className="flex items-center gap-3 text-sm font-normal text-[var(--app-text)]">
                <Trash2 size={17} className="text-[var(--app-danger)]" />
                清空聊天记录
              </strong>
              <small className="mt-1 ml-7 block text-xs text-[var(--app-text-tertiary)]">
                只清除当前账号的本地可见记录
              </small>
            </span>
            <Popconfirm
              title="确定清空本人的聊天记录？"
              description="该操作无法撤销"
              okText="确定清空"
              cancelText="取消"
              onConfirm={() => settingMutation.mutate({ clearHistory: true })}
            >
              <Button danger type="text">
                清空
              </Button>
            </Popconfirm>
          </div>
        </div>

        {isGroup && (
          <div className={`${cardClass} mt-3`}>
            {isOwner ? (
              <>
                <button
                  type="button"
                  className={`${rowClass} border-b border-[var(--app-line)]`}
                  onClick={() => setTransferOpen(true)}
                >
                  <span className="flex items-center gap-3 text-sm text-[var(--app-text)]">
                    <Crown size={17} className="text-amber-600" />
                    转移群主
                  </span>
                  <ChevronRight size={17} />
                </button>
                <Popconfirm
                  title="确定解散该群聊？"
                  description="所有成员都将退出，且该操作无法撤销"
                  okText="解散群聊"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() =>
                    groupActionMutation.mutate({ type: "dissolve" })
                  }
                >
                  <Button
                    danger
                    type="text"
                    block
                    className="!justify-start !px-4"
                    icon={<Trash2 size={17} />}
                  >
                    解散群聊
                  </Button>
                </Popconfirm>
              </>
            ) : (
              <Popconfirm
                title="确定退出该群聊？"
                description="退出后将不再接收群消息"
                okText="退出群聊"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => groupActionMutation.mutate({ type: "leave" })}
              >
                <Button
                  danger
                  type="text"
                  block
                  className="!justify-start !px-4"
                  icon={<LogOut size={17} />}
                >
                  退出群聊
                </Button>
              </Popconfirm>
            )}
          </div>
        )}
      </Modal>

      {isGroup && (
        <>
          <Modal
            open={nameOpen}
            title="修改群聊名称"
            width={430}
            okText="保存"
            cancelText="取消"
            confirmLoading={groupUpdateMutation.isPending}
            okButtonProps={{
              disabled:
                !groupName.trim() || groupName.trim() === conversation.name,
            }}
            onOk={() => groupUpdateMutation.mutate({ name: groupName.trim() })}
            onCancel={() => setNameOpen(false)}
            destroyOnHidden
          >
            <Input
              value={groupName}
              maxLength={80}
              showCount
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="请输入群聊名称"
            />
          </Modal>
          <GroupAnnouncementModal
            open={announcementOpen}
            conversation={conversation}
            currentUser={currentUser}
            onClose={() => setAnnouncementOpen(false)}
            onPublished={async (message) => {
              const updatedConversation: Conversation = {
                ...conversation,
                announcement: message.summary,
                announcementMessageId: message.id,
                announcementMessage: message,
                lastMessage: `[群公告] ${message.summary}`,
                lastMessageId: message.id,
                lastMessageAt: message.createdAt,
              };
              if (localDatabase.available())
                await Promise.all([
                  localDatabase.upsertMessages([message]),
                  localDatabase.upsertConversations([updatedConversation]),
                ]);
              queryClient.setQueryData<InfiniteData<MessagePage<Message>>>(
                queryKeys.messages(conversation.id),
                (current) => {
                  if (!current)
                    return {
                      pages: [{ items: [message], nextCursor: null }],
                      pageParams: [undefined],
                    };
                  const pages = [...current.pages];
                  pages[0] = {
                    ...pages[0],
                    items: [
                      ...pages[0].items.filter(
                        (item) => item.clientId !== message.clientId,
                      ),
                      message,
                    ],
                  };
                  return { ...current, pages };
                },
              );
              queryClient.setQueryData<Conversation[]>(
                queryKeys.conversations,
                (current) =>
                  current?.map((item) =>
                    item.id === conversation.id
                      ? { ...item, ...updatedConversation }
                      : item,
                  ),
              );
              await refreshConversation();
              setAnnouncementOpen(false);
            }}
          />
          <Modal
            open={transferOpen}
            title="转移群主"
            width={430}
            okText="确认转移"
            cancelText="取消"
            confirmLoading={groupActionMutation.isPending}
            okButtonProps={{ disabled: !newOwnerId }}
            onOk={() =>
              newOwnerId &&
              groupActionMutation.mutate({
                type: "transfer",
                userId: newOwnerId,
              })
            }
            onCancel={() => setTransferOpen(false)}
            destroyOnHidden
          >
            <Alert
              className="mb-4"
              type="warning"
              showIcon
              message="转移后你将成为普通群成员"
            />
            <Select
              className="w-full"
              value={newOwnerId}
              options={ownerOptions}
              placeholder="选择新的群主"
              showSearch
              optionFilterProp="label"
              onChange={setNewOwnerId}
              notFoundContent="没有可转移的群成员"
            />
          </Modal>
        </>
      )}
      <ConversationBotsModal
        open={botsOpen}
        conversation={conversation}
        onClose={() => setBotsOpen(false)}
      />
    </>
  );
}
