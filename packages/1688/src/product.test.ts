import { describe, expect, it, vi, afterEach } from "vitest";
import { decodeHtml, extractJsonArray, fetchDetailImages } from "./product";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeHtml", () => {
  it("解码 HTML 实体", () => {
    expect(decodeHtml("黑色&gt;XL")).toBe("黑色>XL");
    expect(decodeHtml("A &amp; B &lt;x&gt;")).toBe("A & B <x>");
    expect(decodeHtml("普通文本")).toBe("普通文本");
  });
});

describe("extractJsonArray", () => {
  it("从 featureAttributes 提取完整属性数组", () => {
    const html = `{"offerDetail":{"detailUrl":"x","featureAttributes":[
      {"fid":401,"name":"货号","value":"发258","values":["发258"],"vids":[564142350]},
      {"fid":346,"name":"产地","value":"海城","values":["海城"],"vids":[3939058]}
    ]}}`;
    const attrs = extractJsonArray(html, "featureAttributes");
    expect(attrs).toHaveLength(2);
    expect(attrs[0]).toMatchObject({ name: "货号", value: "发258" });
    expect(attrs[1]).toMatchObject({ name: "产地", values: ["海城"] });
  });

  it("属性值含中文括号也能正确截断", () => {
    const html = `{"featureAttributes":[{"name":"主面料成分含量","values":["50%（含）-70%（不含）"]}]}`;
    const attrs = extractJsonArray(html, "featureAttributes");
    expect(attrs).toHaveLength(1);
    expect((attrs[0] as Record<string, unknown>).values).toEqual(["50%（含）-70%（不含）"]);
  });

  it("key 不存在返回空数组", () => {
    expect(extractJsonArray("{}", "featureAttributes")).toEqual([]);
  });
});

describe("fetchDetailImages", () => {
  it("从 offer_details content 提取详情图（含协议相对 URL）", async () => {
    const body =
      'var offer_details={"content":"<div><img src=\\"https://cbu01.alicdn.com/a.jpg\\"/><p><img src=\\"//cbu01.alicdn.com/b.jpg\\"/></p></div>"};';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const imgs = await fetchDetailImages("https://itemcdn.tmall.com/xxx");
    expect(imgs).toEqual([
      "https://cbu01.alicdn.com/a.jpg",
      "https://cbu01.alicdn.com/b.jpg",
    ]);
  });

  it("无 detailUrl 或请求失败返回空数组", async () => {
    expect(await fetchDetailImages("")).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net");
      }),
    );
    expect(await fetchDetailImages("https://x")).toEqual([]);
  });
});
