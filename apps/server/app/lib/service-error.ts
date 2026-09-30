/** 携带可安全返回给客户端的业务错误，不依赖 HTTP 响应上下文。 */
export class ServiceError extends Error {
  /** 记录原有接口约定的状态码、错误码和用户提示。 */
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
