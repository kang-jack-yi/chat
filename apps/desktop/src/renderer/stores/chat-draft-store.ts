import { create } from "zustand";
import type { DraftAttachment, Message } from "@chat/shared";

export interface DraftAttachmentItem {
  meta: DraftAttachment;
  file: File;
}

export interface ConversationDraft {
  text: string;
  attachments: DraftAttachmentItem[];
  quote?: Message;
}

export const emptyConversationDraft = (): ConversationDraft => ({
  text: "",
  attachments: [],
});

interface ChatDraftStore {
  drafts: Record<number, ConversationDraft>;
  updateDraft(
    conversationId: number,
    updater: (draft: ConversationDraft) => ConversationDraft,
  ): void;
  removeDraft(conversationId: number): void;
  reset(): void;
}

export const useChatDraftStore = create<ChatDraftStore>((set) => ({
  drafts: {},
  updateDraft: (conversationId, updater) => set((state) => ({
    drafts: {
      ...state.drafts,
      [conversationId]: updater(
        state.drafts[conversationId] || emptyConversationDraft(),
      ),
    },
  })),
  removeDraft: (conversationId) => set((state) => {
    const drafts = { ...state.drafts };
    delete drafts[conversationId];
    return { drafts };
  }),
  reset: () => set({ drafts: {} }),
}));
