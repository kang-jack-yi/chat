import type { Application } from "egg";

export default (app: Application) => {
  const { router, controller } = app;
  const auth = app.middleware.auth();

  app.io.route("typing:start", app.io.controller.chat.typingStart);
  app.io.route("typing:stop", app.io.controller.chat.typingStop);

  router.get("/api/health", controller.sync.health);
  router.post("/api/auth/company-register", controller.auth.companyRegister);
  router.post("/api/auth/login", controller.auth.login);
  router.post("/api/auth/refresh", controller.auth.refresh);
  router.post("/api/auth/logout", controller.auth.logout);
  router.get("/api/auth/me", auth, controller.auth.me);

  router.get("/api/company", auth, controller.organization.company);
  router.patch("/api/company", auth, controller.organization.updateCompany);
  router.get("/api/departments", auth, controller.organization.departments);
  router.post("/api/departments", auth, controller.organization.createDepartment);
  router.patch("/api/departments/:id", auth, controller.organization.updateDepartment);
  router.delete("/api/departments/:id", auth, controller.organization.deleteDepartment);
  router.get("/api/users", auth, controller.organization.users);
  router.post("/api/users", auth, controller.organization.createUser);
  router.patch("/api/users/:id", auth, controller.organization.updateUser);
  router.post("/api/users/:id/reset-password", auth, controller.organization.resetPassword);
  router.post("/api/users/:id/status", auth, controller.organization.setStatus);
  router.get("/api/contacts", auth, controller.organization.contacts);
  router.get("/api/sync/bootstrap", auth, controller.sync.bootstrap);
  router.get("/api/sync/events", auth, controller.sync.events);
  router.get("/api/sync/status", auth, controller.sync.status);

  router.get("/api/documents", auth, controller.documents.list);
  router.post("/api/documents", auth, controller.documents.create);
  router.post("/api/documents/import", auth, controller.documents.importFile);
  router.get("/api/documents/:id/download", auth, controller.documents.download);
  router.get("/api/documents/:id", auth, controller.documents.detail);
  router.patch("/api/documents/:id", auth, controller.documents.update);
  router.put("/api/documents/:id/members", auth, controller.documents.share);
  router.delete("/api/documents/:id", auth, controller.documents.remove);

  router.get("/api/conversations", auth, controller.chat.list);
  router.post("/api/conversations", auth, controller.chat.create);
  router.get("/api/conversations/:id", auth, controller.chat.detail);
  router.patch("/api/conversations/:id", auth, controller.chat.update);
  router.post("/api/conversations/:id/announcement", auth, controller.chat.publishAnnouncement);
  router.delete("/api/conversations/:id", auth, controller.chat.dissolve);
  router.patch("/api/conversations/:id/settings", auth, controller.chat.settings);
  router.post("/api/conversations/:id/owner", auth, controller.chat.transferOwner);
  router.post("/api/conversations/:id/members", auth, controller.chat.addMembers);
  router.delete("/api/conversations/:id/members/:userId", auth, controller.chat.removeMember);
  router.get("/api/conversations/:id/messages", auth, controller.chat.messages);
  router.post("/api/conversations/:id/messages", auth, controller.chat.send);
  router.post("/api/conversations/:id/messages/forward", auth, controller.chat.forward);
  router.post("/api/conversations/:id/messages/delete-for-me", auth, controller.chat.deleteForMe);
  router.post("/api/conversations/:id/messages/:messageId/recall", auth, controller.chat.recall);
  router.post("/api/conversations/:id/read", auth, controller.chat.read);

  router.post("/api/uploads", auth, controller.upload.upload);
  router.delete("/api/uploads/:id", auth, controller.upload.remove);
  router.get("/api/files/:id", auth, controller.upload.download);
};
