import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeMtopSign, mtopToken, parseJsonp } from "./mtop";

describe("mtop 签名", () => {
  it("makeMtopSign 与 md5 公式一致", () => {
    const token = "tok123";
    const ts = 1700000000000;
    const data = "{}";
    const expected = createHash("md5")
      .update(`${token}&${ts}&12574478&${data}`)
      .digest("hex");
    expect(makeMtopSign(token, ts, data)).toBe(expected);
  });

  it("mtopToken 取 _m_h5_tk 的 _ 前缀", () => {
    expect(mtopToken({ _m_h5_tk: "abc123_1700000000" })).toBe("abc123");
    expect(mtopToken({ _m_h5_tk: "noUnderscore" })).toBe("noUnderscore");
    expect(mtopToken({})).toBe("");
  });

  it("parseJsonp 解析 JSON 与 JSONP 包裹", () => {
    expect(parseJsonp('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonp('callback({"a":1})')).toEqual({ a: 1 });
    expect(parseJsonp('  mtopjsonp2({"b":[1,2]})  ')).toEqual({ b: [1, 2] });
    expect(typeof parseJsonp("not json at all")).toBe("string");
  });
});
