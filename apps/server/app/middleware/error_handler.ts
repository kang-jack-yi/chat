import type { Context } from "egg";

export default () => async (ctx: Context, next: () => Promise<any>) => {
  try {
    await next();
  } catch (error: any) {
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
