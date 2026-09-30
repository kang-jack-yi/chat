import type { Application } from "egg";
import { DataTypes, Model, ModelStatic, Op, Sequelize } from "sequelize";
import path from "node:path";
import fs from "node:fs/promises";
import bcrypt from "bcryptjs";

type AnyModel = ModelStatic<Model<any, any>>;

export interface ChatDatabase {
  sequelize: Sequelize;
  Company: AnyModel;
  Department: AnyModel;
  User: AnyModel;
  Conversation: AnyModel;
  ConversationMember: AnyModel;
  ConversationBot: AnyModel;
  BotMedia: AnyModel;
  Message: AnyModel;
  MessageUserState: AnyModel;
  Attachment: AnyModel;
  CloudDocument: AnyModel;
  CloudDocumentMember: AnyModel;
  CloudDocumentComment: AnyModel;
  Task: AnyModel;
  Notification: AnyModel;
  SyncEvent: AnyModel;
  ServerSetting: AnyModel;
  DesktopRefreshSession: AnyModel;
}

function defineModels(sequelize: Sequelize): ChatDatabase {
  const common = { timestamps: true, underscored: true };
  const Company = sequelize.define("Company", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    code: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    ownerId: { type: DataTypes.INTEGER, allowNull: true },
  }, { ...common, tableName: "companies" });

  const Department = sequelize.define("Department", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    parentId: { type: DataTypes.INTEGER, allowNull: true },
    name: { type: DataTypes.STRING(60), allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { ...common, tableName: "departments", indexes: [{ fields: ["company_id", "parent_id"] }] });

  const User = sequelize.define("User", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    departmentId: { type: DataTypes.INTEGER, allowNull: true },
    phone: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(100), allowNull: false },
    name: { type: DataTypes.STRING(40), allowNull: false },
    title: { type: DataTypes.STRING(60), allowNull: false, defaultValue: "" },
    avatar: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "" },
    avatarFile: { type: DataTypes.STRING(500), allowNull: true },
    email: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" },
    bio: { type: DataTypes.STRING(300), allowNull: false, defaultValue: "" },
    presenceStatus: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "available" },
    statusText: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "" },
    statusExpiresAt: { type: DataTypes.DATE, allowNull: true },
    role: { type: DataTypes.ENUM("owner", "admin", "member"), allowNull: false, defaultValue: "member" },
    status: { type: DataTypes.ENUM("active", "disabled"), allowNull: false, defaultValue: "active" },
  }, { ...common, tableName: "users", indexes: [{ fields: ["company_id", "department_id"] }] });

  const Conversation = sequelize.define("Conversation", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.ENUM("direct", "group"), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "" },
    announcement: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    announcementMessageId: { type: DataTypes.INTEGER, allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: false },
    directKey: { type: DataTypes.STRING(80), allowNull: true, unique: true },
    lastMessage: { type: DataTypes.STRING(200), allowNull: false, defaultValue: "" },
    lastMessageAt: { type: DataTypes.DATE, allowNull: true },
  }, { ...common, tableName: "conversations", indexes: [{ fields: ["company_id", "last_message_at"] }] });

  const ConversationMember = sequelize.define("ConversationMember", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    lastReadMessageId: { type: DataTypes.INTEGER, allowNull: true },
    clearedAtMessageId: { type: DataTypes.INTEGER, allowNull: true },
    isPinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isMuted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isHidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    hiddenAtMessageId: { type: DataTypes.INTEGER, allowNull: true },
    lastMentionMessageId: { type: DataTypes.INTEGER, allowNull: true },
    lastMentionType: { type: DataTypes.STRING(10), allowNull: true },
    historyVisibleAfterMessageId: { type: DataTypes.INTEGER, allowNull: true },
    invitedHistoryMessageIds: { type: DataTypes.JSON, allowNull: true },
    joinedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    leftAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    ...common,
    tableName: "conversation_members",
    indexes: [{ unique: true, fields: ["conversation_id", "user_id"] }, { fields: ["user_id", "left_at"] }],
  });

  const ConversationBot = sequelize.define("ConversationBot", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(40), allowNull: false },
    avatar: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "" },
    createdBy: { type: DataTypes.INTEGER, allowNull: false },
    secret: { type: DataTypes.STRING(160), allowNull: false },
    secretTail: { type: DataTypes.STRING(12), allowNull: false },
    deletedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    ...common,
    tableName: "conversation_bots",
    indexes: [{ fields: ["company_id", "conversation_id", "deleted_at"] }],
  });

  const BotMedia = sequelize.define("BotMedia", {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    botId: { type: DataTypes.INTEGER, allowNull: false },
    attachmentId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.ENUM("file"), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
  }, { ...common, tableName: "bot_media", indexes: [{ fields: ["bot_id", "expires_at"] }] });

  const Message = sequelize.define("Message", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    senderId: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    senderType: { type: DataTypes.ENUM("user", "bot"), allowNull: false, defaultValue: "user" },
    senderBotId: { type: DataTypes.INTEGER, allowNull: true },
    senderName: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "" },
    senderAvatar: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "" },
    clientId: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    kind: { type: DataTypes.ENUM("user", "system", "announcement"), allowNull: false, defaultValue: "user" },
    schemaVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    payloadJson: { type: DataTypes.JSON, allowNull: false },
    summary: { type: DataTypes.STRING(200), allowNull: false, defaultValue: "" },
    searchText: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    deletedAt: { type: DataTypes.DATE, allowNull: true },
  }, { ...common, tableName: "messages", indexes: [{ fields: ["conversation_id", "id"] }] });

  const MessageUserState = sequelize.define("MessageUserState", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    messageId: { type: DataTypes.INTEGER, allowNull: false },
    deletedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    ...common,
    tableName: "message_user_states",
    indexes: [
      { unique: true, fields: ["user_id", "message_id"] },
      { fields: ["user_id", "conversation_id", "message_id"] },
    ],
  });

  const Attachment = sequelize.define("Attachment", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    uploaderId: { type: DataTypes.INTEGER, allowNull: false },
    messageId: { type: DataTypes.INTEGER, allowNull: true },
    originalName: { type: DataTypes.STRING(255), allowNull: false },
    storedName: { type: DataTypes.STRING(255), allowNull: false },
    mimeType: { type: DataTypes.STRING(120), allowNull: false },
    size: { type: DataTypes.INTEGER, allowNull: false },
    relativePath: { type: DataTypes.STRING(500), allowNull: false },
  }, { ...common, tableName: "attachments", indexes: [{ fields: ["company_id", "uploader_id"] }] });

  const CloudDocument = sequelize.define("CloudDocument", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    ownerId: { type: DataTypes.INTEGER, allowNull: false },
    lastEditorId: { type: DataTypes.INTEGER, allowNull: true },
    title: { type: DataTypes.STRING(120), allowNull: false },
    type: { type: DataTypes.ENUM("doc", "sheet"), allowNull: false, defaultValue: "doc" },
    icon: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "doc" },
    color: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "#1677ff" },
    yjsState: { type: DataTypes.BLOB("long"), allowNull: true },
    trashedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    ...common,
    tableName: "cloud_documents",
    indexes: [
      { fields: ["company_id", "updated_at"] },
      { fields: ["owner_id", "trashed_at"] },
    ],
  });

  const CloudDocumentMember = sequelize.define("CloudDocumentMember", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    documentId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    permission: {
      type: DataTypes.ENUM("owner", "editor", "viewer"),
      allowNull: false,
      defaultValue: "viewer",
    },
    isFavorite: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastOpenedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    ...common,
    tableName: "cloud_document_members",
    indexes: [
      { unique: true, fields: ["document_id", "user_id"] },
      { fields: ["user_id", "last_opened_at"] },
    ],
  });

  const CloudDocumentComment = sequelize.define("CloudDocumentComment", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    documentId: { type: DataTypes.INTEGER, allowNull: false },
    authorId: { type: DataTypes.INTEGER, allowNull: false },
    parentId: { type: DataTypes.INTEGER, allowNull: true },
    anchor: { type: DataTypes.STRING(120), allowNull: true },
    content: { type: DataTypes.TEXT, allowNull: false },
    resolvedAt: { type: DataTypes.DATE, allowNull: true },
    resolvedById: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    ...common,
    tableName: "cloud_document_comments",
    indexes: [
      { fields: ["document_id", "created_at"] },
      { fields: ["document_id", "resolved_at"] },
      { fields: ["author_id"] },
    ],
  });

  const Task = sequelize.define("Task", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    creatorId: { type: DataTypes.INTEGER, allowNull: false },
    assigneeId: { type: DataTypes.INTEGER, allowNull: false },
    conversationId: { type: DataTypes.INTEGER, allowNull: true },
    messageId: { type: DataTypes.INTEGER, allowNull: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    status: { type: DataTypes.ENUM("todo", "in_progress", "done", "cancelled"), allowNull: false, defaultValue: "todo" },
    priority: { type: DataTypes.ENUM("low", "normal", "high", "urgent"), allowNull: false, defaultValue: "normal" },
    dueAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    ...common,
    tableName: "tasks",
    indexes: [
      { fields: ["company_id", "assignee_id", "status"] },
      { fields: ["company_id", "due_at"] },
      { fields: ["conversation_id", "message_id"] },
    ],
  });

  const Notification = sequelize.define("Notification", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    recipientUserId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.ENUM("task_assigned", "task_completed", "mention", "comment", "system"), allowNull: false },
    title: { type: DataTypes.STRING(120), allowNull: false },
    body: { type: DataTypes.STRING(500), allowNull: false, defaultValue: "" },
    entityType: { type: DataTypes.STRING(40), allowNull: false },
    entityId: { type: DataTypes.STRING(80), allowNull: false },
    conversationId: { type: DataTypes.INTEGER, allowNull: true },
    taskId: { type: DataTypes.INTEGER, allowNull: true },
    documentId: { type: DataTypes.INTEGER, allowNull: true },
    payload: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    readAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    ...common,
    tableName: "notifications",
    indexes: [
      { fields: ["recipient_user_id", "read_at", "created_at"] },
      { fields: ["company_id", "created_at"] },
    ],
  });

  const SyncEvent = sequelize.define("SyncEvent", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    recipientUserId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.STRING(40), allowNull: false },
    entityId: { type: DataTypes.STRING(80), allowNull: false },
    conversationId: { type: DataTypes.INTEGER, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    payload: { type: DataTypes.JSON, allowNull: false },
  }, {
    ...common,
    tableName: "sync_events",
    indexes: [
      { fields: ["recipient_user_id", "id"] },
      { fields: ["company_id", "created_at"] },
    ],
  });

  const ServerSetting = sequelize.define("ServerSetting", {
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    serverId: { type: DataTypes.UUID, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    name: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "企业协作服务" },
  }, { ...common, tableName: "server_settings" });

  const DesktopRefreshSession = sequelize.define("DesktopRefreshSession", {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    companyId: { type: DataTypes.INTEGER, allowNull: false },
    deviceId: { type: DataTypes.STRING(80), allowNull: false },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    ...common,
    tableName: "desktop_refresh_sessions",
    indexes: [{ fields: ["user_id", "device_id"] }, { fields: ["expires_at"] }],
  });

  return {
    sequelize,
    Company,
    Department,
    User,
    Conversation,
    ConversationMember,
    ConversationBot,
    BotMedia,
    Message,
    MessageUserState,
    Attachment,
    CloudDocument,
    CloudDocumentMember,
    CloudDocumentComment,
    Task,
    Notification,
    SyncEvent,
    ServerSetting,
    DesktopRefreshSession,
  };
}

export async function initializeDatabase(app: Application): Promise<ChatDatabase> {
  const dataDir = path.join(app.baseDir, "data");
  const databasePath = process.env.CHAT_DATABASE_PATH
    ? path.resolve(process.env.CHAT_DATABASE_PATH)
    : path.join(dataDir, "chat.sqlite");
  const uploadDir = path.join(app.baseDir, "storage", "uploads");
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  await fs.mkdir(uploadDir, { recursive: true });
  const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: databasePath,
    logging: false,
  });
  const db = defineModels(sequelize);
  await sequelize.sync();
  await db.ServerSetting.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1, name: process.env.CHAT_SERVER_NAME || "企业协作服务" },
  });
  await db.SyncEvent.destroy({
    where: { createdAt: { [Op.lt]: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) } },
  });
  const queryInterface = sequelize.getQueryInterface();
  const userColumns = await queryInterface.describeTable("users");
  if (!userColumns.avatar_file) {
    await queryInterface.addColumn("users", "avatar_file", { type: DataTypes.STRING(500), allowNull: true });
  }
  if (!userColumns.email) {
    await queryInterface.addColumn("users", "email", { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" });
  }
  if (!userColumns.bio) {
    await queryInterface.addColumn("users", "bio", { type: DataTypes.STRING(300), allowNull: false, defaultValue: "" });
  }
  if (!userColumns.presence_status) {
    await queryInterface.addColumn("users", "presence_status", { type: DataTypes.STRING(16), allowNull: false, defaultValue: "available" });
  }
  if (!userColumns.status_text) {
    await queryInterface.addColumn("users", "status_text", { type: DataTypes.STRING(80), allowNull: false, defaultValue: "" });
  }
  if (!userColumns.status_expires_at) {
    await queryInterface.addColumn("users", "status_expires_at", { type: DataTypes.DATE, allowNull: true });
  }
  const conversationColumns = await queryInterface.describeTable("conversations");
  if (!conversationColumns.announcement) {
    await queryInterface.addColumn("conversations", "announcement", {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    });
  }
  if (!conversationColumns.announcement_message_id) {
    await queryInterface.addColumn("conversations", "announcement_message_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }
  const membershipColumns = await queryInterface.describeTable("conversation_members");
  if (!membershipColumns.cleared_at_message_id) {
    await queryInterface.addColumn("conversation_members", "cleared_at_message_id", { type: DataTypes.INTEGER, allowNull: true });
  }
  if (!membershipColumns.is_pinned) {
    await queryInterface.addColumn("conversation_members", "is_pinned", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  }
  if (!membershipColumns.is_muted) {
    await queryInterface.addColumn("conversation_members", "is_muted", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  }
  if (!membershipColumns.is_hidden) {
    await queryInterface.addColumn("conversation_members", "is_hidden", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  }
  if (!membershipColumns.hidden_at_message_id) {
    await queryInterface.addColumn("conversation_members", "hidden_at_message_id", { type: DataTypes.INTEGER, allowNull: true });
  }
  if (!membershipColumns.last_mention_message_id) {
    await queryInterface.addColumn("conversation_members", "last_mention_message_id", { type: DataTypes.INTEGER, allowNull: true });
  }
  if (!membershipColumns.last_mention_type) {
    await queryInterface.addColumn("conversation_members", "last_mention_type", { type: DataTypes.STRING(10), allowNull: true });
  }
  if (!membershipColumns.history_visible_after_message_id) {
    await queryInterface.addColumn("conversation_members", "history_visible_after_message_id", { type: DataTypes.INTEGER, allowNull: true });
  }
  if (!membershipColumns.invited_history_message_ids) {
    await queryInterface.addColumn("conversation_members", "invited_history_message_ids", { type: DataTypes.JSON, allowNull: true });
  }
  const messageColumns = await queryInterface.describeTable("messages");
  if (!messageColumns.sender_type) {
    await queryInterface.addColumn("messages", "sender_type", {
      type: DataTypes.ENUM("user", "bot"),
      allowNull: false,
      defaultValue: "user",
    });
  }
  if (!messageColumns.sender_bot_id) {
    await queryInterface.addColumn("messages", "sender_bot_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }
  if (!messageColumns.sender_name) {
    await queryInterface.addColumn("messages", "sender_name", {
      type: DataTypes.STRING(40), allowNull: false, defaultValue: "",
    });
  }
  if (!messageColumns.sender_avatar) {
    await queryInterface.addColumn("messages", "sender_avatar", {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: "",
    });
  }
  const notificationColumns = await queryInterface.describeTable("notifications");
  if (!notificationColumns.document_id) {
    await queryInterface.addColumn("notifications", "document_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }
  app.chatDb = db;
  await seedDemoData(db);
  return db;
}

export async function seedDemoData(db: ChatDatabase, force = false) {
  const count = await db.Company.count();
  if (count > 0 && !force) return;
  const transaction = await db.sequelize.transaction();
  try {
    const company = await db.Company.create({ name: "星海科技", code: "XINGHAI", ownerId: null }, { transaction });
    const root = await db.Department.create({ companyId: company.get("id"), parentId: null, name: "星海科技", sortOrder: 0 }, { transaction });
    const product = await db.Department.create({ companyId: company.get("id"), parentId: root.get("id"), name: "产品中心", sortOrder: 10 }, { transaction });
    const tech = await db.Department.create({ companyId: company.get("id"), parentId: root.get("id"), name: "技术中心", sortOrder: 20 }, { transaction });
    const market = await db.Department.create({ companyId: company.get("id"), parentId: root.get("id"), name: "市场运营", sortOrder: 30 }, { transaction });
    const passwordHash = await bcrypt.hash("123456", 10);
    const users = await Promise.all([
      db.User.create({ companyId: company.get("id"), departmentId: product.get("id"), phone: "13800000001", passwordHash, name: "林远", title: "产品负责人", avatar: "林", role: "owner", status: "active" }, { transaction }),
      db.User.create({ companyId: company.get("id"), departmentId: tech.get("id"), phone: "13800000002", passwordHash, name: "陈默", title: "前端工程师", avatar: "陈", role: "admin", status: "active" }, { transaction }),
      db.User.create({ companyId: company.get("id"), departmentId: tech.get("id"), phone: "13800000003", passwordHash, name: "周琪", title: "后端工程师", avatar: "周", role: "member", status: "active" }, { transaction }),
      db.User.create({ companyId: company.get("id"), departmentId: market.get("id"), phone: "13800000004", passwordHash, name: "苏清", title: "品牌运营", avatar: "苏", role: "member", status: "active" }, { transaction }),
      db.User.create({ companyId: company.get("id"), departmentId: product.get("id"), phone: "13800000005", passwordHash, name: "许言", title: "交互设计师", avatar: "许", role: "member", status: "active" }, { transaction }),
    ]);
    await company.update({ ownerId: users[0].get("id") }, { transaction });
    const welcomeDocument = await db.CloudDocument.create({
      companyId: company.get("id"),
      ownerId: users[0].get("id"),
      lastEditorId: users[0].get("id"),
      title: "产品体验优化方案",
      type: "doc",
      icon: "doc",
      color: "#1677ff",
    }, { transaction });
    const projectSheet = await db.CloudDocument.create({
      companyId: company.get("id"),
      ownerId: users[0].get("id"),
      lastEditorId: users[0].get("id"),
      title: "项目进度跟踪表",
      type: "sheet",
      icon: "sheet",
      color: "#13a36f",
    }, { transaction });
    await db.CloudDocumentMember.bulkCreate([
      { documentId: welcomeDocument.get("id"), userId: users[0].get("id"), permission: "owner", lastOpenedAt: new Date() },
      { documentId: welcomeDocument.get("id"), userId: users[1].get("id"), permission: "editor" },
      { documentId: projectSheet.get("id"), userId: users[0].get("id"), permission: "owner", lastOpenedAt: new Date() },
      { documentId: projectSheet.get("id"), userId: users[2].get("id"), permission: "viewer" },
    ], { transaction });
    const direct = await db.Conversation.create({
      companyId: company.get("id"), type: "direct", name: "", createdBy: users[0].get("id"),
      directKey: `${company.get("id")}:${users[0].get("id")}:${users[1].get("id")}`,
      lastMessage: "新版工作台已经同步，方便时帮我看一下", lastMessageAt: new Date(),
    }, { transaction });
    const group = await db.Conversation.create({
      companyId: company.get("id"), type: "group", name: "产品体验优化群", createdBy: users[0].get("id"),
      lastMessage: "今天下午三点一起过一下最新方案", lastMessageAt: new Date(Date.now() - 1000 * 60 * 18),
    }, { transaction });
    for (const user of users.slice(0, 2)) {
      await db.ConversationMember.create({ conversationId: direct.get("id"), userId: user.get("id") }, { transaction });
    }
    for (const user of users) {
      await db.ConversationMember.create({ conversationId: group.get("id"), userId: user.get("id") }, { transaction });
    }
    await db.Message.create({
      companyId: company.get("id"), conversationId: direct.get("id"), senderId: users[1].get("id"),
      clientId: "seed-direct-1", kind: "user", schemaVersion: 1,
      payloadJson: [{ type: "text", text: "早上好，工作台的交互我已经调整完了。" }],
      summary: "早上好，工作台的交互我已经调整完了。",
      searchText: "早上好，工作台的交互我已经调整完了。",
      createdAt: new Date(Date.now() - 1000 * 60 * 35),
    }, { transaction });
    await db.Message.create({
      companyId: company.get("id"), conversationId: direct.get("id"), senderId: users[0].get("id"),
      clientId: "seed-direct-2", kind: "user", schemaVersion: 1,
      payloadJson: [{ type: "text", text: "新版工作台已经同步，方便时帮我看一下" }],
      summary: "新版工作台已经同步，方便时帮我看一下",
      searchText: "新版工作台已经同步，方便时帮我看一下",
      createdAt: new Date(Date.now() - 1000 * 60 * 2),
    }, { transaction });
    await db.Message.create({
      companyId: company.get("id"), conversationId: group.get("id"), senderId: users[3].get("id"),
      clientId: "seed-group-1", kind: "user", schemaVersion: 1,
      payloadJson: [{ type: "text", text: "今天下午三点一起过一下最新方案" }],
      summary: "今天下午三点一起过一下最新方案",
      searchText: "今天下午三点一起过一下最新方案",
      createdAt: new Date(Date.now() - 1000 * 60 * 18),
    }, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export function toPlain<T = any>(row: any): T {
  return row?.get ? row.get({ plain: true }) : row;
}
