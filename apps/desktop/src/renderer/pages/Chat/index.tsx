import { useEffect, useState } from "react";
import { Button, Modal, message } from "antd";
import { ChevronLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { ROUTES } from "../../constants/routes";
import { useAppStore } from "../../stores/app-store";
import { useUserStore } from "../../stores/user-store";
import { queryKeys } from "../../constants/query-keys";
import { organizationService } from "../../services/organization";
import ConversationList from "./components/ConversationList";
import ChatPanel from "./components/ChatPanel";
import GroupDialog from "./components/GroupDialog";
import { useConversations } from "./hooks";
import ChatSidePanel from "./components/ChatSidePanel";
import ConversationSettingsModal from "./components/ConversationSettingsModal";
import InviteGroupMembersModal from "./components/InviteGroupMembersModal";
import type { Conversation, LocalMessage, Message } from "@chat/shared";
import { chatService } from "../../services/chat";
import { localDatabase } from "../../services/local-database";
import { useChatDraftStore } from "../../stores/chat-draft-store";
import type { MessagePage } from "../../types/api";

export default function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useUserStore((state) => state.session)!;
  const mobileDetailOpen = useAppStore((state) => state.mobileDetailOpen);
  const groupDialogOpen = useAppStore((state) => state.groupDialogOpen);
  const setMobileDetailOpen = useAppStore((state) => state.setMobileDetailOpen);
  const setGroupDialogOpen = useAppStore((state) => state.setGroupDialogOpen);
  const conversations = useConversations();
  const users = useQuery({ queryKey: queryKeys.users, queryFn: organizationService.users });
  const selectedId = Number(conversationId) || undefined;
  const selectedConversation = conversations.data?.find((item) => item.id === selectedId) ?? null;
  const showMembers = selectedConversation?.type === "group";
  const [focusedMessageId, setFocusedMessageId] = useState<number>();
  const [pendingSearchTarget, setPendingSearchTarget] = useState<{
    conversationId: number;
    messageId: number;
  }>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const removeDraft = useChatDraftStore((state) => state.removeDraft);
  const drafts = useChatDraftStore((state) => state.drafts);

  useEffect(() => {
    if (!selectedId && conversations.data?.length) {
      navigate(ROUTES.chatDetail(conversations.data[0].id), { replace: true });
    }
  }, [conversations.data, navigate, selectedId]);

  useEffect(() => {
    if (selectedId && conversations.data && !selectedConversation) {
      const fallback = conversations.data[0];
      navigate(fallback ? ROUTES.chatDetail(fallback.id) : ROUTES.chat, { replace: true });
    }
  }, [conversations.data, navigate, selectedConversation, selectedId]);

  useEffect(() => {
    setFocusedMessageId(undefined);
    setSettingsOpen(false);
    setInviteOpen(false);
  }, [selectedConversation?.id, selectedConversation?.type]);

  useEffect(() => {
    void window.desktop?.screenshot.setActiveConversation(selectedConversation?.id);
    return () => {
      void window.desktop?.screenshot.setActiveConversation();
    };
  }, [selectedConversation?.id]);

  useEffect(() => window.desktop?.screenshot.onUnavailable(() => {
    message.warning("请先打开一个会话");
  }), []);

  useEffect(() => {
    if (!pendingSearchTarget || pendingSearchTarget.conversationId !== selectedId) return;
    setFocusedMessageId(pendingSearchTarget.messageId);
    setPendingSearchTarget(undefined);
  }, [pendingSearchTarget, selectedId]);

  function selectConversation(id: number) {
    navigate(ROUTES.chatDetail(id));
    setMobileDetailOpen(true);
  }

  async function startDirectChat(userId: number) {
    try {
      const conversation = await chatService.createDirect(userId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      selectConversation(conversation.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "无法发起会话");
      throw error;
    }
  }

  async function updateConversationSetting(
    conversation: Conversation,
    payload: { pinned?: boolean; muted?: boolean; hidden?: boolean },
  ) {
    try {
      await chatService.settings(conversation.id, payload);
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "会话设置更新失败");
    }
  }

  async function locateSearchResult(conversation: Conversation, messageId?: number) {
    try {
      if (conversation.hidden) {
        await chatService.settings(conversation.id, { hidden: false });
        await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      }
      if (messageId) {
        setPendingSearchTarget({ conversationId: conversation.id, messageId });
      }
      selectConversation(conversation.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "无法打开搜索结果");
    }
  }

  useEffect(() => window.desktop?.windows.onLocateHistoryMessage(
    ({ conversationId: targetConversationId, messageId }) => {
      const conversation = conversations.data?.find(
        (item) => item.id === targetConversationId,
      );
      if (!conversation) return;
      void locateSearchResult(conversation, messageId);
    },
  ), [conversations.data]);

  function openChatHistory() {
    if (!selectedConversation) return;
    void window.desktop?.windows.openChatHistory({
      conversationId: selectedConversation.id,
    }).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : "无法打开聊天记录");
    });
  }

  async function deleteConversationHistory(conversation: Conversation) {
    const cachedMessages = queryClient.getQueryData<InfiniteData<MessagePage<Message>>>(
      queryKeys.messages(conversation.id),
    );
    const hasActiveMessage = cachedMessages?.pages.some((page) =>
      page.items.some((item) =>
        ["queued", "uploading", "sending"].includes(
          String((item as Partial<LocalMessage>).status || ""),
        ))) ?? false;
    if (
      hasActiveMessage
      ||
      localDatabase.available()
      && await localDatabase.hasPendingConversation(conversation.id)
    ) {
      message.warning("该会话仍有等待发送的消息，请先完成或取消发送");
      return;
    }
    Modal.confirm({
      title: "删除聊天记录",
      content: "将清除当前账号中的聊天记录和草稿，并隐藏该会话。此操作不会影响其他成员。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      async onOk() {
        try {
          const draft = drafts[conversation.id];
          await chatService.settings(conversation.id, {
            clearHistory: true,
            hidden: true,
          });
          await Promise.all((draft?.attachments ?? []).map((item) =>
            window.desktop?.attachment.removeDraft(item.meta.id).catch(() => undefined)));
          removeDraft(conversation.id);
          await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
        } catch (error) {
          message.error(error instanceof Error ? error.message : "删除聊天记录失败");
          throw error;
        }
      },
    });
  }

  return (
    <div className="chat-theme relative grid h-full w-full min-w-0 grid-cols-[258px_minmax(0,1fr)] overflow-hidden bg-[var(--chat-canvas)] max-lg:grid-cols-[238px_minmax(0,1fr)] max-md:grid-cols-1">
      <section className="flex min-w-0 max-w-full flex-col overflow-hidden border-r border-[var(--chat-line)] bg-[var(--chat-list)]">
        <ConversationList
          conversations={conversations.data ?? []}
          loading={conversations.isLoading}
          selectedId={selectedId}
          onSelect={selectConversation}
          onNewGroup={() => setGroupDialogOpen(true)}
          onSetting={(conversation, payload) => {
            void updateConversationSetting(conversation, payload);
          }}
          onDelete={(conversation) => {
            void deleteConversationHistory(conversation);
          }}
          onLocateSearchResult={(conversation, messageId) => {
            void locateSearchResult(conversation, messageId);
          }}
        />
      </section>
      <main
        className={`relative grid min-h-0 min-w-0 max-w-full grid-rows-[minmax(0,1fr)] overflow-hidden bg-[var(--chat-canvas)] transition-transform duration-200 max-md:absolute max-md:inset-0 max-md:z-10 ${mobileDetailOpen ? "max-md:translate-x-0" : "max-md:translate-x-full"}`}
        style={{
          gridTemplateColumns: showMembers
            ? "minmax(0, 1fr) 160px"
            : "minmax(0, 1fr)",
        }}
      >
        <Button
          type="text"
          icon={<ChevronLeft size={20} />}
          aria-label="返回会话列表"
          onClick={() => setMobileDetailOpen(false)}
          className="!absolute !top-4 !left-2 !z-10 !hidden max-md:!inline-flex"
        />
        <ChatPanel
          conversation={selectedConversation}
          currentUser={session.user}
          companyName={session.company.name}
          users={users.data ?? []}
          conversations={conversations.data ?? []}
          showHeaderAction={!showMembers}
          focusedMessageId={focusedMessageId}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHistory={openChatHistory}
          onClearFocusedMessage={() => setFocusedMessageId(undefined)}
          onFocusMessage={setFocusedMessageId}
          onStartDirectChat={startDirectChat}
          onViewMember={(userId) => navigate(ROUTES.contactDetail(userId))}
        />
        {selectedConversation && showMembers && (
          <ChatSidePanel
            conversation={selectedConversation}
            currentUser={session.user}
            companyName={session.company.name}
            users={users.data ?? []}
            onOpenHistory={openChatHistory}
            onInvite={() => setInviteOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onStartDirectChat={startDirectChat}
            onViewMember={(userId) => navigate(ROUTES.contactDetail(userId))}
          />
        )}
      </main>
      <GroupDialog
        open={groupDialogOpen}
        users={(users.data ?? []).filter((user) => user.id !== session.user.id && user.status === "active")}
        onClose={() => setGroupDialogOpen(false)}
        onCreated={async (conversation) => {
          setGroupDialogOpen(false);
          await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
          selectConversation(conversation.id);
        }}
      />
      {selectedConversation && (
        <>
          <ConversationSettingsModal
            open={settingsOpen}
            conversation={selectedConversation}
            currentUser={session.user}
            onClose={() => setSettingsOpen(false)}
            onRemoved={() => {
              setSettingsOpen(false);
              navigate(ROUTES.chat, { replace: true });
            }}
          />
          {selectedConversation.type === "group" && (
            <InviteGroupMembersModal
              open={inviteOpen}
              conversation={selectedConversation}
              users={users.data ?? []}
              onClose={() => setInviteOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
