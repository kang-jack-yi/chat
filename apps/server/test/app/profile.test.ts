import { app } from "egg-mock/bootstrap";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { Op } from "sequelize";

describe("个人资料接口", () => {
  async function login(phone = "13800000003") {
    const response = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone, password: "123456" })
      .expect(200);
    return {
      authorization: `Bearer ${response.body.data.accessToken}`,
      user: response.body.data.user,
    };
  }

  it("仅允许当前用户修改自助资料字段并产生联系人同步事件", async () => {
    const session = await login();
    const row = await app.chatDb.User.findByPk(session.user.id);
    assert.ok(row);
    const original = row!.toJSON() as any;
    const cursor = Number(await app.chatDb.SyncEvent.max("id") || 0);
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    try {
      const response = await app.httpRequest()
        .patch("/api/auth/profile")
        .set("Authorization", session.authorization)
        .send({
          name: "周琪测试",
          email: "zhouqi@example.com",
          bio: "专注后端平台与协作体验",
          presenceStatus: "busy",
          statusText: "会议中",
          statusExpiresAt: expiry,
          phone: "13900000000",
          title: "不应被修改",
          departmentId: null,
          role: "owner",
          status: "disabled",
        })
        .expect(200);

      assert.equal(response.body.data.name, "周琪测试");
      assert.equal(response.body.data.email, "zhouqi@example.com");
      assert.equal(response.body.data.bio, "专注后端平台与协作体验");
      assert.equal(response.body.data.presenceStatus, "busy");
      assert.equal(response.body.data.statusText, "会议中");
      assert.equal(response.body.data.phone, original.phone);
      assert.equal(response.body.data.title, original.title);
      assert.equal(response.body.data.departmentId, original.departmentId);
      assert.equal(response.body.data.role, original.role);
      assert.equal(response.body.data.status, original.status);

      const refreshed = await row!.reload();
      assert.equal(refreshed.get("phone"), original.phone);
      assert.equal(refreshed.get("title"), original.title);
      assert.equal(refreshed.get("departmentId"), original.departmentId);
      assert.equal(refreshed.get("role"), original.role);
      assert.equal(refreshed.get("status"), original.status);

      const syncEvent = await app.chatDb.SyncEvent.findOne({
        where: {
          id: { [Op.gt]: cursor },
          type: "contact.upsert",
          entityId: String(session.user.id),
        },
        order: [["id", "DESC"]],
      });
      assert.ok(syncEvent);
      assert.equal((syncEvent!.get("payload") as any).email, "zhouqi@example.com");
    } finally {
      await row!.update({
        name: original.name,
        avatar: original.avatar,
        email: original.email || "",
        bio: original.bio || "",
        presenceStatus: original.presenceStatus || "available",
        statusText: original.statusText || "",
        statusExpiresAt: original.statusExpiresAt || null,
      });
      await app.chatDb.SyncEvent.destroy({ where: { id: { [Op.gt]: cursor } } });
    }
  });

  it("校验资料字段格式", async () => {
    const session = await login();
    const response = await app.httpRequest()
      .patch("/api/auth/profile")
      .set("Authorization", session.authorization)
      .send({ email: "invalid-email" })
      .expect(400);
    assert.equal(response.body.error.code, "INVALID_EMAIL");
  });

  it("支持上传头像，同企业可读取且跨企业不可读取", async () => {
    const session = await login();
    const row = await app.chatDb.User.findByPk(session.user.id);
    assert.ok(row);
    const previousAvatarFile = row!.get("avatarFile") ? String(row!.get("avatarFile")) : null;
    const cursor = Number(await app.chatDb.SyncEvent.max("id") || 0);
    let uploadedAvatarFile: string | null = null;
    let foreignCompanyId: number | null = null;

    try {
      const uploaded = await app.httpRequest()
        .post("/api/auth/profile/avatar")
        .set("Authorization", session.authorization)
        .attach("file", Buffer.from("profile-avatar-test"), {
          filename: "avatar.png",
          contentType: "image/png",
        })
        .expect(200);
      assert.match(uploaded.body.data.avatarUrl, new RegExp(`^/api/users/${session.user.id}/avatar\\?v=`));
      uploadedAvatarFile = String((await row!.reload()).get("avatarFile"));

      const avatar = await app.httpRequest()
        .get(uploaded.body.data.avatarUrl)
        .set("Authorization", session.authorization)
        .expect(200);
      assert.match(String(avatar.headers["content-type"]), /^image\/png/);
      assert.equal(Buffer.from(avatar.body).toString(), "profile-avatar-test");

      const foreignPhone = `139${String(Date.now()).slice(-8)}`;
      const foreign = await app.httpRequest()
        .post("/api/auth/company-register")
        .send({ companyName: "头像隔离测试企业", name: "隔离用户", phone: foreignPhone, password: "123456" })
        .expect(200);
      foreignCompanyId = foreign.body.data.user.companyId;
      await app.httpRequest()
        .get(uploaded.body.data.avatarUrl)
        .set("Authorization", `Bearer ${foreign.body.data.accessToken}`)
        .expect(404);

      const syncEvent = await app.chatDb.SyncEvent.findOne({
        where: { id: { [Op.gt]: cursor }, type: "contact.upsert", entityId: String(session.user.id) },
      });
      assert.ok(syncEvent);
      assert.ok((syncEvent!.get("payload") as any).avatarUrl);
    } finally {
      await row!.update({ avatarFile: previousAvatarFile });
      if (uploadedAvatarFile) {
        await fsp.rm(path.join(app.baseDir, "storage", "avatars", uploadedAvatarFile), { force: true });
      }
      await app.chatDb.SyncEvent.destroy({ where: { id: { [Op.gt]: cursor } } });
      if (foreignCompanyId) {
        await app.chatDb.DesktopRefreshSession.destroy({ where: { companyId: foreignCompanyId } });
        await app.chatDb.User.destroy({ where: { companyId: foreignCompanyId } });
        await app.chatDb.Department.destroy({ where: { companyId: foreignCompanyId } });
        await app.chatDb.Company.destroy({ where: { id: foreignCompanyId } });
      }
    }
  });
});
