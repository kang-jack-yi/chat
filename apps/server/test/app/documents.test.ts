import { app } from "egg-mock/bootstrap";
import assert from "node:assert/strict";

describe("云文档接口", () => {
  it("支持创建、共享、权限校验和删除", async () => {
    const [ownerLogin, memberLogin] = await Promise.all([
      app.httpRequest()
        .post("/api/auth/login")
        .send({ phone: "13800000001", password: "123456" })
        .expect(200),
      app.httpRequest()
        .post("/api/auth/login")
        .send({ phone: "13800000002", password: "123456" })
        .expect(200),
    ]);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    const created = await app.httpRequest()
      .post("/api/documents")
      .set("Authorization", ownerAuth)
      .send({ type: "sheet", title: "协同测试表格" })
      .expect(200);
    const documentId = Number(created.body.data.id);

    try {
      assert.equal(created.body.data.type, "sheet");
      assert.equal(created.body.data.permission, "owner");

      const mine = await app.httpRequest()
        .get("/api/documents?view=mine")
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.ok(mine.body.data.some((item: any) => item.id === documentId));

      const shared = await app.httpRequest()
        .put(`/api/documents/${documentId}/members`)
        .set("Authorization", ownerAuth)
        .send({
          members: [{
            userId: memberLogin.body.data.user.id,
            permission: "viewer",
          }],
        })
        .expect(200);
      assert.ok(shared.body.data.members.some((item: any) =>
        item.userId === memberLogin.body.data.user.id && item.permission === "viewer"));

      const detail = await app.httpRequest()
        .get(`/api/documents/${documentId}`)
        .set("Authorization", memberAuth)
        .expect(200);
      assert.equal(detail.body.data.document.permission, "viewer");
      assert.match(detail.body.data.collaborationUrl, /^ws/);

      const denied = await app.httpRequest()
        .patch(`/api/documents/${documentId}`)
        .set("Authorization", memberAuth)
        .send({ title: "不允许的重命名" })
        .expect(403);
      assert.equal(denied.body.error.code, "DOCUMENT_READ_ONLY");

      await app.httpRequest()
        .delete(`/api/documents/${documentId}`)
        .set("Authorization", ownerAuth)
        .expect(200);
      await app.httpRequest()
        .get(`/api/documents/${documentId}`)
        .set("Authorization", memberAuth)
        .expect(404);
    } finally {
      await app.chatDb.CloudDocumentMember.destroy({ where: { documentId }, force: true });
      await app.chatDb.CloudDocument.destroy({ where: { id: documentId }, force: true });
    }
  });
});
