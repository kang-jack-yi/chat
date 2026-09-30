import { describe, expect, it } from "vitest";
import { messageTextSegments } from "./MessageContent";

describe("messageTextSegments", () => {
  it("识别 http 和 https 链接并保留其他文本", () => {
    expect(messageTextSegments("访问 http://127.0.0.1:7001/a?x=1 和 https://example.com。"))
      .toEqual([
        { type: "text", value: "访问 " },
        { type: "url", value: "http://127.0.0.1:7001/a?x=1" },
        { type: "text", value: " 和 " },
        { type: "url", value: "https://example.com" },
        { type: "text", value: "。" },
      ]);
  });

  it("不把其他协议识别为链接", () => {
    expect(messageTextSegments("ftp://example.com javascript:alert(1)"))
      .toEqual([{ type: "text", value: "ftp://example.com javascript:alert(1)" }]);
  });
});
