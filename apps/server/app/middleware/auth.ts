import type { Context } from "egg";
import { bearerToken, fail, resolveSession } from "../lib/auth";

export default () => async (ctx: Context, next: () => Promise<any>) => {
  const user = await resolveSession(ctx.app, bearerToken(ctx));
  if (!user) {
    fail(ctx, 401, "UNAUTHORIZED", "登录状态已失效，请重新登录");
    return;
  }
  ctx.currentUser = user;
  await next();
};
