/** 只允许交给系统浏览器打开 HTTP(S)，阻止脚本、文件及其他协议。 */
export function externalWebUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅允许打开 HTTP 或 HTTPS 链接");
  }
  return parsed.toString();
}
