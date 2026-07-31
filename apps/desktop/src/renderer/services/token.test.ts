import { beforeEach, describe, expect, it } from "vitest";
import { clearAccessToken, getAccessToken, setAccessToken } from "./token";

describe("access token", () => {
  beforeEach(clearAccessToken);

  it("仅保存在当前页面内存中并支持清理", () => {
    expect(getAccessToken()).toBeNull();
    setAccessToken("test-token");
    expect(getAccessToken()).toBe("test-token");
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });
});
