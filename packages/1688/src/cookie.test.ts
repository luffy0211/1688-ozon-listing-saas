import { describe, expect, it } from "vitest";
import { cookieHeader, hasLoginCookies, toCookieRecord } from "./cookie";

describe("cookie 转换", () => {
  it("toCookieRecord 归一化", () => {
    const record = toCookieRecord([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
      { name: "", value: "x" }, // 忽略空名
    ]);
    expect(record).toEqual({ a: "1", b: "2" });
  });

  it("cookieHeader 拼接", () => {
    expect(cookieHeader({ a: "1", b: "2" })).toBe("a=1; b=2");
  });

  it("hasLoginCookies 判断登录态", () => {
    expect(hasLoginCookies({ unb: "xyz" })).toBe(true);
    expect(hasLoginCookies({ cookie2: "0" })).toBe(false);
    expect(hasLoginCookies({})).toBe(false);
  });
});
