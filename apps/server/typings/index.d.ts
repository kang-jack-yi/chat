import type { ChatDatabase } from "../app/lib/database";
import type { Server } from "@hocuspocus/server";

declare module "egg" {
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
