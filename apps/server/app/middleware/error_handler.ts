import type { Context } from "egg";
import { ServiceError } from "../lib/service-error";

export default () => async (ctx: Context, next: () => Promise<any>) => {
  try {
    await next();
  } catch (error: any) {
    if (error instanceof ServiceError) {
      ctx.status = error.status;
      ctx.body = {
        success: false,
        error: { code: error.code, message: error.message },
      };
      return;
    }
    ctx.app.emit("error", error, ctx);
    const isValidation = error?.name === "SequelizeValidationError" || error?.name === "SequelizeUniqueConstraintError";
    ctx.status = isValidation ? 400 : 500;
    ctx.body = {
      success: false,
      error: {
        code: isValidation ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
        message: isValidation ? "提交的数据不符合要求或已存在" : "服务暂时不可用，请稍后重试",
      },
    };
  }
};
