import type { ChatDatabase } from "../app/lib/database";
import type { Server } from "@hocuspocus/server";
import type AuthService from "../app/service/auth";
import type ChatService from "../app/service/chat";
import type ConversationBotService from "../app/service/conversation_bot";
import type DocumentsService from "../app/service/documents";
import type NotificationsService from "../app/service/notifications";
import type OrganizationService from "../app/service/organization";
import type SyncService from "../app/service/sync";
import type TasksService from "../app/service/tasks";
import type UploadService from "../app/service/upload";

declare module "egg" {
  interface IService {
    auth: AuthService;
    chat: ChatService;
    conversationBot: ConversationBotService;
    documents: DocumentsService;
    notifications: NotificationsService;
    organization: OrganizationService;
    sync: SyncService;
    tasks: TasksService;
    upload: UploadService;
  }
  interface Application {
    chatDb: ChatDatabase;
    collaborationServer?: Server;
    io: any;
  }
  interface Context {
    currentUser?: any;
    socket: any;
    args: any[];
  }
  interface EggAppConfig {
    jwtSecret: string;
    io: any;
  }
}
