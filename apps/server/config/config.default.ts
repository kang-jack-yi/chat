import { EggAppConfig, EggAppInfo, PowerPartial } from "egg";
import path from "node:path";

export default (appInfo: EggAppInfo) => {
  const config = {} as PowerPartial<EggAppConfig> & Record<string, any>;
  const logDir = path.join(appInfo.root, "logs", appInfo.name);
  const loggerLevel = (process.env.CHAT_LOG_LEVEL || "INFO") as "DEBUG" | "INFO" | "WARN" | "ERROR" | "NONE";
  const consoleLevel = (process.env.CHAT_CONSOLE_LOG_LEVEL || "WARN") as "DEBUG" | "INFO" | "WARN" | "ERROR" | "NONE";
  config.keys = appInfo.name + "_local_chat_secret_2026";
  config.middleware = ["errorHandler"];
  config.security = {
    csrf: { enable: false },
  };
  const configuredOrigins = String(process.env.CHAT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const developmentOrigins = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:15173",
    "http://localhost:15173",
    "chat://app",
  ];
  const allowedOrigins = new Set([...configuredOrigins, ...developmentOrigins]);
  config.cors = {
    origin: (ctx: any) => {
      const origin = ctx.get("origin");
      return allowedOrigins.has(origin) ? origin : "";
    },
    credentials: true,
    allowMethods: "GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS",
    allowHeaders: "Content-Type,Authorization,X-Desktop-Version",
  };
  config.multipart = {
    mode: "stream",
    fileSize: "50mb",
    whitelist: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".zip"],
  };
  config.static = {
    prefix: "/public/",
    dir: path.join(appInfo.baseDir, "app/public"),
  };
  config.logger = {
    dir: logDir,
    level: loggerLevel,
    consoleLevel,
    disableConsoleAfterReady: true,
    appLogName: "app-web.log",
    coreLogName: "egg-web.log",
    agentLogName: "egg-agent.log",
    errorLogName: "common-error.log",
  };
  config.logrotator = {
    filesRotateBySize: [
      path.join(logDir, "app-web.log"),
      path.join(logDir, "egg-web.log"),
      path.join(logDir, "egg-agent.log"),
      path.join(logDir, "common-error.log"),
    ],
    maxFileSize: Number(process.env.CHAT_LOG_MAX_SIZE || 20 * 1024 * 1024),
    maxFiles: Number(process.env.CHAT_LOG_MAX_FILES || 3),
    maxDays: Number(process.env.CHAT_LOG_MAX_DAYS || 7),
    rotateDuration: Number(process.env.CHAT_LOG_ROTATE_INTERVAL || 10000),
  };
  config.jwtSecret = process.env.CHAT_JWT_SECRET || "change-this-secret-before-production";
  config.io = {
    init: {
      path: "/socket.io",
      cors: { origin: [...allowedOrigins], credentials: true },
    },
    namespace: {
      "/": {
        connectionMiddleware: ["auth"],
        packetMiddleware: [],
      },
    },
  };
  return config;
};
