import { describe, expect, it } from "vitest";
import { externalWebUrl } from "./external-links";

describe("系统浏览器链接边界", () => {
  it("支持本地 HTTP 和远程 HTTPS，保留路径与参数", () => {
    expect(externalWebUrl("http://127.0.0.1:7001/a?key=demo")).toBe(
      "http://127.0.0.1:7001/a?key=demo",
    );
    expect(externalWebUrl("https://example.com/docs?q=hello#intro")).toBe(
      "https://example.com/docs?q=hello#intro",
    );
  });

  it.each([
    "javascript:alert(1)",
    "file:///C:/Windows/win.ini",
    "data:text/html,test",
    "ftp://example.com/a",
    "not-a-url",
  ])("拒绝不安全或无效链接 %s", (value) => {
    expect(() => externalWebUrl(value)).toThrow();
  });
});
