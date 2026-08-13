export type UserRole = "owner" | "admin" | "member";
export type UserStatus = "active" | "disabled";
export type PresenceStatus = "available" | "busy" | "dnd" | "away";
export type ConversationType = "direct" | "group";
export type MessageKind = "user" | "system" | "announcement";
export type MessageStatus = "queued" | "uploading" | "sending" | "sent" | "failed";

export interface Company {
  id: number;
  name: string;
  code: string;
  ownerId: number;
}

export interface Department {
  id: number;
  companyId: number;
  parentId: number | null;
  name: string;
  sortOrder: number;
  memberCount?: number;
}

export interface User {
  id: number;
  companyId: number;
  departmentId: number | null;
  phone: string;
  name: string;
  title: string;
  avatar: string;
  avatarUrl?: string;
  email: string;
  bio: string;
  presenceStatus: PresenceStatus;
  statusText: string;
  statusExpiresAt: string | null;
  role: UserRole;
  status: UserStatus;
  departmentName?: string;
  online?: boolean;
}

export type CloudDocumentType = "doc" | "sheet";
export type CloudDocumentPermission = "owner" | "editor" | "viewer";
export type CloudDocumentListView = "recent" | "mine" | "shared" | "favorite";

export interface CloudDocumentMember {
  userId: number;
  name: string;
  avatar: string;
  permission: CloudDocumentPermission;
}

export interface CloudDocument {
  id: number;
  companyId: number;
  ownerId: number;
  title: string;
  type: CloudDocumentType;
  icon: string;
  color: string;
  permission: CloudDocumentPermission;
  favorite: boolean;
  members: CloudDocumentMember[];
  lastEditor?: Pick<User, "id" | "name" | "avatar"> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudDocumentEditorConfig {
  document: CloudDocument;
  collaborationUrl: string;
}

export interface Attachment {
  id: number;
  draftId?: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface TextPart {
  type: "text";
  text: string;
}

/** Webhook 机器人发送的 Markdown 正文。 */
export interface MarkdownPart {
  type: "markdown";
  content: string;
}

export interface MentionPart {
  type: "mention";
  userId: number;
  label: string;
}

export interface MentionAllPart {
  type: "mention_all";
  label: "所有人";
}

export interface ImagePart {
  type: "image";
  attachment: Attachment;
  width: number;
  height: number;
}

export interface FilePart {
  type: "file";
  attachment: Attachment;
}

export interface QuotePart {
  type: "quote";
  messageId: number;
  senderId: number;
  senderName: string;
  summary: string;
}

export interface ForwardQuoteSnapshotPart {
  type: "quote_snapshot";
  senderName: string;
  summary: string;
}

export type ForwardSnapshotPart =
  | TextPart
  | MarkdownPart
  | MentionPart
  | MentionAllPart
  | ImagePart
  | FilePart
  | ForwardQuoteSnapshotPart;

export interface ForwardMessageSnapshot {
  originalMessageId: number;
  senderId: number;
  senderName: string;
  senderAvatar: string;
  createdAt: string;
  summary: string;
  parts: ForwardSnapshotPart[];
}

export interface ForwardedMessagePart {
  type: "forwarded_message";
  snapshot: ForwardMessageSnapshot;
}

export interface ChatRecordPart {
  type: "chat_record";
  title: string;
  items: ForwardMessageSnapshot[];
}

export interface SystemActor {
  userId: number;
  name: string;
}

export type SystemMessageEvent =
  | {
      type: "group_created";
      actor: SystemActor;
      invitedMembers: SystemActor[];
    }
  | {
      type: "members_invited";
      actor: SystemActor;
      members: SystemActor[];
    }
  | {
      type: "member_left";
      actor: SystemActor;
    }
  | {
      type: "member_removed";
      actor: SystemActor;
      member: SystemActor;
    }
  | {
      type: "group_renamed";
      actor: SystemActor;
      oldName: string;
      newName: string;
    }
  | {
      type: "group_announcement_updated";
      actor: SystemActor;
    }
  | {
      type: "owner_transferred";
      actor: SystemActor;
      newOwner: SystemActor;
    }
  | {
      type: "message_recalled";
      actor: SystemActor;
      targetMessageId: number;
    };

export interface SystemEventPart {
  type: "system_event";
  event: SystemMessageEvent;
}

export type MessagePart =
  | TextPart
  | MarkdownPart
  | MentionPart
  | MentionAllPart
  | ImagePart
  | FilePart
  | QuotePart
  | ForwardQuoteSnapshotPart
  | SystemEventPart
  | ForwardedMessagePart
  | ChatRecordPart;

export interface OutgoingTextPart {
  type: "text";
  text: string;
}

export interface OutgoingMentionPart {
  type: "mention";
  userId: number;
  label: string;
}

export interface OutgoingMentionAllPart {
  type: "mention_all";
  label: "所有人";
}

export interface OutgoingImagePart {
  type: "image";
  attachmentId: number;
  width: number;
  height: number;
}

export interface OutgoingFilePart {
  type: "file";
  attachmentId: number;
}

export interface OutgoingQuotePart {
  type: "quote";
  messageId: number;
}

export type OutgoingMessagePart =
  | OutgoingTextPart
  | OutgoingMentionPart
  | OutgoingMentionAllPart
  | OutgoingImagePart
  | OutgoingFilePart
  | OutgoingQuotePart;

export interface ImMessage {
  schemaVersion: 1;
  id: number;
  clientId: string;
  conversationId: number;
  /** 员工发送者 ID；机器人消息为 0。 */
  senderId: number;
  /** 消息发送主体，机器人不伪装为企业成员。 */
  senderType?: "user" | "bot";
  /** 机器人 ID；仅 senderType 为 bot 时存在。 */
  senderBotId?: number | null;
  senderName: string;
  senderAvatar: string;
  /** 机器人名称与头像在发送时的快照，删除机器人后历史仍可展示。 */
  senderBot?: Pick<ConversationBot, "id" | "name" | "avatar"> | null;
  kind: MessageKind;
  parts: MessagePart[];
  summary: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  readCount?: number;
  recipientCount?: number;
}

export type Message = ImMessage;

/** 会话级 Webhook 机器人，不属于企业通讯录成员。 */
export interface ConversationBot {
  id: number;
  conversationId: number;
  companyId: number;
  name: string;
  avatar: string;
  createdBy: number;
  createdByName?: string;
  secretTail: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationBotWithWebhook extends ConversationBot {
  webhookUrl: string;
}

export interface MessageReceiptDetails {
  messageId: number;
  read: User[];
  unread: User[];
}

export type MessageHistoryCategory = "all" | "file" | "media";

export interface MessageHistoryQuery {
  conversationId: number;
  keyword?: string;
  senderId?: number;
  startAt?: string;
  endAt?: string;
  category: MessageHistoryCategory;
  cursor?: string;
  limit: number;
}

export interface MessageHistoryHit {
  message: Message;
  snippet: string;
}

export interface MessageHistoryPage {
  items: MessageHistoryHit[];
  nextCursor: string | null;
}

export interface MessageContext {
  targetId: number;
  items: Message[];
}

export interface Conversation {
  id: number;
  type: ConversationType;
  createdBy: number;
  name: string;
  announcement?: string;
  announcementMessageId?: number | null;
  announcementMessage?: Message | null;
  avatar: string;
  lastMessage: string;
  lastMessageId: number | null;
  lastMessageAt: string | null;
  unreadCount: number;
  memberCount: number;
  online?: boolean;
  members?: User[];
  pinned?: boolean;
  muted?: boolean;
  hidden?: boolean;
  mentioned?: boolean;
  mentionMessageId?: number | null;
  mentionType?: "member" | "all" | null;
}

export interface GlobalMessageSearchQuery {
  keyword: string;
  cursor?: string;
  limit: number;
}

export interface GlobalMessageSearchHit {
  conversation: Conversation;
  message: Message;
  snippet: string;
}

export interface GlobalMessageSearchPage {
  conversations: Conversation[];
  messages: GlobalMessageSearchHit[];
  nextCursor: string | null;
  historyComplete: boolean;
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        fields?: Record<string, string>;
      };
    };

export interface SessionData {
  user: User;
  company: Company;
}

export interface AuthData extends SessionData {
  accessToken: string;
}

export interface AccessTokenData {
  accessToken: string;
}

export interface ServerHealth {
  serviceId: "enterprise-chat";
  serverId: string;
  name: string;
  apiVersion: "1";
  socketPath: "/socket.io";
  minDesktopVersion: string;
  features: {
    companyRegistration: boolean;
    fileUpload: boolean;
  };
  serverTime: string;
}

export interface ServerConfig {
  url: string;
  serverId: string;
  name: string;
  apiVersion: string;
  socketPath: string;
}

export type DesktopTheme = "light" | "dark" | "system";
export type DesktopZoom = 0.9 | 1 | 1.1 | 1.25;
export type ChatSendKey = "enter" | "ctrlEnter";
export type ChatFontSize = 13 | 14 | 15 | 16;
export type ChatDensity = "comfortable" | "compact";

export interface AppearancePreferences {
  theme: DesktopTheme;
  zoom: DesktopZoom;
  reducedMotion: boolean;
}

export interface GeneralPreferences {
  launchAtLogin: boolean;
  closeToTray: boolean;
  downloadDirectory: string | null;
}

export interface ChatPreferences {
  sendKey: ChatSendKey;
  fontSize: ChatFontSize;
  density: ChatDensity;
}

export interface DesktopPreferences {
  appearance: AppearancePreferences;
  general: GeneralPreferences;
  chat: ChatPreferences;
}

export interface DesktopPreferencesUpdate {
  appearance?: Partial<AppearancePreferences>;
  general?: Partial<GeneralPreferences>;
  chat?: Partial<ChatPreferences>;
}

export interface DesktopStorageStats {
  attachmentCacheBytes: number;
  attachmentFileCount: number;
}

export type SyncEventType =
  | "message.upsert"
  | "message.delete"
  | "message.user-delete"
  | "conversation.upsert"
  | "conversation.delete"
  | "member.upsert"
  | "read.updated"
  | "contact.upsert"
  | "department.upsert";

export interface SyncEvent<T = unknown> {
  seq: number;
  type: SyncEventType;
  entityId: string;
  conversationId?: number;
  version: number;
  payload: T;
  occurredAt: string;
}

export interface SyncBootstrap {
  cursor: number;
  users: User[];
  departments: Department[];
  conversations: Conversation[];
  messages: Message[];
}

export interface SyncEventPage {
  events: SyncEvent[];
  nextCursor: number;
  hasMore: boolean;
}

export interface SyncStatus {
  cursor: number;
  minimumCursor: number;
  maximumCursor: number;
  historyComplete: boolean;
  phase?: "idle" | "bootstrap" | "incremental" | "history" | "offline" | "error";
  message?: string;
}

export interface LocalImMessage extends ImMessage {
  localId: string;
  serverId: number | null;
  status: MessageStatus;
  progress?: number;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export type LocalMessage = LocalImMessage;

export interface SendMessagePayload {
  conversationId: number;
  clientId: string;
  schemaVersion: 1;
  parts: OutgoingMessagePart[];
}

export type PublishAnnouncementPayload = SendMessagePayload;

export interface RecallMessageResult {
  recalledMessageId: number;
  systemMessage: Message;
}

export interface ForwardMessagesInput {
  requestId: string;
  messageIds: number[];
  targetConversationIds: number[];
  mode: "individual" | "merged";
}

export interface ForwardMessagesResult {
  deliveries: Array<{
    conversationId: number;
    messages: Message[];
  }>;
}

export interface DeleteMessagesForMeResult {
  conversationId: number;
  deletedMessageIds: number[];
}

export interface MessagesRemovedForMeEvent extends DeleteMessagesForMeResult {}

export interface MessageRecalledEvent extends RecallMessageResult {
  conversationId: number;
}

export interface OpenInviteHistoryInput {
  conversationId: number;
  selectedMessageIds: number[];
  defaultSelectAll: boolean;
}

export interface InviteHistoryResult {
  confirmed: boolean;
  selectedMessageIds: number[];
  selectedCount: number;
}

export interface OpenImageViewerInput {
  conversationId: number;
  messageId?: number;
  attachmentId?: number;
  draftId?: string;
}

export interface OpenChatHistoryInput {
  conversationId: number;
}

export interface OpenForwardRecordInput {
  conversationId: number;
  messageId: number;
}

export interface ChatHistoryMetadata {
  conversation: Conversation;
  historyComplete: boolean;
  currentUserId: number;
}

export interface ImageGalleryItem {
  key: string;
  conversationId: number;
  messageId: number;
  attachmentId?: number;
  draftId?: string;
  originalName: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface ImageGalleryPage {
  items: ImageGalleryItem[];
  previousCursor: string | null;
  nextCursor: string | null;
  historyComplete: boolean;
}

export interface InviteHistoryTask {
  taskId: string;
  type: "invite-history";
  sessionEpoch: number;
  conversationId: number;
  selectedMessageIds: number[];
  defaultSelectAll: boolean;
}

export interface ImageViewerTask {
  taskId: string;
  type: "image-viewer";
  sessionEpoch: number;
  conversationId: number;
  initialMessageId?: number;
  initialAttachmentId?: number;
  initialDraftId?: string;
}

export interface ChatHistoryTask {
  taskId: string;
  type: "chat-history";
  sessionEpoch: number;
  conversationId: number;
}

export interface ForwardRecordTask {
  taskId: string;
  type: "forward-record";
  sessionEpoch: number;
  conversationId: number;
  messageId: number;
}

export type AuxiliaryTask =
  | InviteHistoryTask
  | ImageViewerTask
  | ChatHistoryTask
  | ForwardRecordTask;

export interface DraftAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  image: boolean;
  width?: number;
  height?: number;
  previewUrl: string;
}

export interface DraftSendCommand {
  conversationId: number;
  text: string;
  attachments: DraftAttachment[];
  quoteMessageId?: number;
}
