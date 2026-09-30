import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Modal, message } from "antd";
import { ChevronLeft } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { get } from "../../services/request";
import { searchTargetId } from "../Search/helpers";

export default function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationRevision = useRef(0);
  // 路由切换或卸载立即使旧定位请求失效，避免迟到响应把用户带回旧会话。
  useLayoutEffect(() => {
    navigationRevision.current += 1;
    return () => { navigationRevision.current += 1; };
  }, [location.key]);
  const [searchParams] = useSearchParams();
  const searchMessageId = searchTargetId(searchParams.get("messageId"));
  const consumedSearchTarget = useRef<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const session = useUserStore((state) => state.session)!;
  const mobileDetailOpen = useAppStore((state) => state.mobileDetailOpen);
  const groupDialogOpen = useAppStore((state) => state.groupDialogOpen);
  const setMobileDetailOpen = useAppStore((state) => state.setMobileDetailOpen);
  const setGroupDialogOpen = useAppStore((state) => state.setGroupDialogOpen);
  const conversations = useConversations();
  const users = useQuery({
    queryKey: queryKeys.users,
    queryFn: organizationService.users,
  });
  const selectedId = Number(conversationId) || undefined;
  const selectedConversation =
    conversations.data?.find((item) => item.id === selectedId) ?? null;
  const searchConversation = useQuery({
    queryKey: ["search-conversation", selectedId, searchMessageId],
    queryFn: () => get<Conversation>(`/api/conversations/${selectedId}`),
    enabled: Boolean(searchMessageId && selectedId && conversations.isSuccess && !selectedConversation),
    retry: false,
  });
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
    if (selectedId && conversations.data && !selectedConversation && !searchMessageId) {
      const fallback = conversations.data[0];
      navigate(fallback ? ROUTES.chatDetail(fallback.id) : ROUTES.chat, {
        replace: true,
      });
    }
  }, [conversations.data, navigate, selectedConversation, selectedId, searchMessageId]);

  useEffect(() => {
    setFocusedMessageId(undefined);
    setSettingsOpen(false);
    setInviteOpen(false);
  }, [selectedConversation?.id, selectedConversation?.type]);

  useEffect(() => {
    void window.desktop?.screenshot.setActiveConversation(
      selectedConversation?.id,
    );
    return () => {
      void window.desktop?.screenshot.setActiveConversation();
    };
  }, [selectedConversation?.id]);

  useEffect(
    () =>
      window.desktop?.screenshot.onUnavailable(() => {
        message.warning("请先打开一个会话");
      }),
    [],
  );

  useEffect(() => {
    if (
      !pendingSearchTarget ||
      pendingSearchTarget.conversationId !== selectedId ||
      selectedConversation?.id !== selectedId
    )
      return;
    setFocusedMessageId(pendingSearchTarget.messageId);
    setPendingSearchTarget(undefined);
  }, [pendingSearchTarget, selectedId, selectedConversation?.id]);

  // 消费统一搜索的消息深链接；隐藏会话补查详情后复用原有展开和定位流程。
  useEffect(() => {
    if (!searchMessageId || !selectedId) {
      consumedSearchTarget.current = undefined;
      return;
    }
    const target = selectedConversation ?? searchConversation.data;
    const targetKey = `${selectedId}:${searchMessageId}`;
    if (!target || consumedSearchTarget.current === targetKey) return;
    consumedSearchTarget.current = targetKey;
    void locateSearchResult(target, searchMessageId, true);
  }, [selectedId, searchMessageId, selectedConversation, searchConversation.data]);

  // 无权限或已删除的深链接给出反馈，并恢复正常会话选择逻辑。
  useEffect(() => {
    if (!searchMessageId || !searchConversation.isError) return;
    message.error(searchConversation.error.message || "无法打开搜索结果");
    navigate(ROUTES.chat, { replace: true });
  }, [searchMessageId, searchConversation.isError, searchConversation.error, navigate]);

  /** 打开会话和移动端详情；搜索深链接消费时可替换当前历史记录。 */
  function selectConversation(id: number, replace = false) {
    navigate(ROUTES.chatDetail(id), { replace });
    setMobileDetailOpen(true);
  }

  async function startDirectChat(userId: number) {
    try {
      const conversation = await chatService.createDirect(userId);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations,
      });
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
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations,
      });
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "会话设置更新失败",
      );
    }
  }

  /** 取消隐藏目标会话并等待会话面板就绪后高亮指定消息。 */
  async function locateSearchResult(
    conversation: Conversation,
    messageId?: number,
    replace = false,
  ) {
    const revision = navigationRevision.current;
    try {
      if (conversation.hidden) {
        await chatService.settings(conversation.id, { hidden: false });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.conversations,
        });
      }
      if (revision !== navigationRevision.current) return;
      if (messageId) {
        setPendingSearchTarget({ conversationId: conversation.id, messageId });
      }
      // 深链接消费时替换历史记录，避免返回按钮反复触发同一次定位。
      selectConversation(conversation.id, replace);
    } catch (error) {
      if (revision !== navigationRevision.current) return;
      message.error(
        error instanceof Error ? error.message : "无法打开搜索结果",
      );
      if (replace) navigate(ROUTES.chat, { replace: true });
    }
  }

  useEffect(
    () =>
      window.desktop?.windows.onLocateHistoryMessage(
        ({ conversationId: targetConversationId, messageId }) => {
          const conversation = conversations.data?.find(
            (item) => item.id === targetConversationId,
          );
          if (!conversation) return;
          void locateSearchResult(conversation, messageId);
        },
      ),
    [conversations.data],
  );

  function openChatHistory() {
    if (!selectedConversation) return;
    void window.desktop?.windows
      .openChatHistory({
        conversationId: selectedConversation.id,
      })
      .catch((error: unknown) => {
        message.error(
          error instanceof Error ? error.message : "无法打开聊天记录",
        );
      });
  }

  async function deleteConversationHistory(conversation: Conversation) {
    const cachedMessages = queryClient.getQueryData<
      InfiniteData<MessagePage<Message>>
    >(queryKeys.messages(conversation.id));
    const hasActiveMessage =
      cachedMessages?.pages.some((page) =>
        page.items.some((item) =>
          ["queued", "uploading", "sending"].includes(
            String((item as Partial<LocalMessage>).status || ""),
          ),
        ),
      ) ?? false;
    if (
      hasActiveMessage ||
      (localDatabase.available() &&
        (await localDatabase.hasPendingConversation(conversation.id)))
    ) {
      message.warning("该会话仍有等待发送的消息，请先完成或取消发送");
      return;
    }
    Modal.confirm({
      title: "删除聊天记录",
      content:
        "将清除当前账号中的聊天记录和草稿，并隐藏该会话。此操作不会影响其他成员。",
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
          await Promise.all(
            (draft?.attachments ?? []).map((item) =>
              window.desktop?.attachment
                .removeDraft(item.meta.id)
                .catch(() => undefined),
            ),
          );
          removeDraft(conversation.id);
          await queryClient.invalidateQueries({
            queryKey: queryKeys.conversations,
          });
        } catch (error) {
          message.error(
            error instanceof Error ? error.message : "删除聊天记录失败",
          );
          throw error;
        }
      },
    });
  }

  return (
    <div className="chat-theme relative grid h-full min-h-0 w-full min-w-0 grid-cols-[258px_minmax(0,1fr)] overflow-hidden bg-[var(--chat-canvas)] max-lg:grid-cols-[238px_minmax(0,1fr)] max-md:grid-cols-1">
      <section className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden border-r border-[var(--chat-line)] bg-[var(--chat-list)]">
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
        className={`relative grid h-full min-h-0 min-w-0 max-w-full grid-rows-[minmax(0,1fr)] overflow-hidden bg-[var(--chat-canvas)] max-md:absolute max-md:inset-0 max-md:z-10 ${mobileDetailOpen ? "max-md:translate-x-0" : "max-md:translate-x-full"}`}
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
        users={(users.data ?? []).filter(
          (user) => user.id !== session.user.id && user.status === "active",
        )}
        onClose={() => setGroupDialogOpen(false)}
        onCreated={async (conversation) => {
          setGroupDialogOpen(false);
          await queryClient.invalidateQueries({
            queryKey: queryKeys.conversations,
          });
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
