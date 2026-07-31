import type { Application } from "egg";
import { initializeDatabase } from "./app/lib/database";
import { startCollaborationServer } from "./app/lib/collaboration";
import type { Server } from "@hocuspocus/server";

export default class AppBootHook {
  private readonly app: Application;
  private collaborationServer: Server | null = null;

  constructor(app: Application) {
    this.app = app;
  }

  async didLoad() {
    await initializeDatabase(this.app);
    if (process.env.CHAT_COLLABORATION_DISABLED !== "1" && this.app.config.env !== "unittest") {
      this.collaborationServer = await startCollaborationServer(this.app);
      this.app.collaborationServer = this.collaborationServer;
    }
  }

  async beforeClose() {
    await this.collaborationServer?.destroy();
    this.collaborationServer = null;
  }
}
