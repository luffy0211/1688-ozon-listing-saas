import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafe1688Url,
  fetchShopProducts,
  fetchShopProductsFromPages,
  is1688Host,
  resolveMemberId,
} from "./shop";

const cookies = { _m_h5_tk: "tok_123", unb: "abc" };

function mockFetchOnce(body: string, url = "https://x") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/plain" } }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveMemberId", () => {
  it("直接 memberId 原样返回", async () => {
    expect(await resolveMemberId("b2b-22208706109357eb0a", cookies)).toBe(
      "b2b-22208706109357eb0a",
    );
  });

  it("URL 里 memberId= 提取", async () => {
    expect(
      await resolveMemberId("https://winport.m.1688.com/?memberId=b2b-999", cookies),
    ).toBe("b2b-999");
  });

  it("店铺页提取 memberId", async () => {
    mockFetchOnce(`<html>{"memberId":"b2b-888"}</html>`);
    expect(await resolveMemberId("https://shop.1688.com/", cookies)).toBe("b2b-888");
  });

  it("根路径被风控时从 page/index.html 提取 memberId", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("<html>captcha</html>", { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            `<html>{"url":"https://winport.m.1688.com/?memberId=b2b-22208706109357eb0a&upstreamSource=pcShare"}</html>`,
            { status: 200 },
          ),
        ),
    );

    expect(await resolveMemberId("https://shop039459ce98570.1688.com", cookies)).toBe(
      "b2b-22208706109357eb0a",
    );
  });
});

describe("SSRF 防护", () => {
  it("is1688Host 仅放行 1688 域", () => {
    expect(is1688Host("1688.com")).toBe(true);
    expect(is1688Host("shop.1688.com")).toBe(true);
    expect(is1688Host("evil.com")).toBe(false);
    expect(is1688Host("127.0.0.1")).toBe(false);
    expect(is1688Host("169.254.169.254")).toBe(false);
    expect(is1688Host("1688.com.evil.com")).toBe(false);
  });

  it("assertSafe1688Url 拒绝非 1688 域名", () => {
    expect(() => assertSafe1688Url("https://shop.1688.com/x")).not.toThrow();
    expect(() => assertSafe1688Url("http://127.0.0.1/admin")).toThrow();
    expect(() => assertSafe1688Url("http://169.254.169.254/")).toThrow();
    expect(() => assertSafe1688Url("https://attacker.example/")).toThrow();
    expect(() => assertSafe1688Url("file:///etc/passwd")).toThrow();
  });
});

describe("fetchShopProducts", () => {
  it("解析 mtop 店铺接口 offerList", async () => {
    const jsonp = `mtopjsonp1({"ret":["SUCCESS::调用成功"],"data":{"content":{"offerList":[
      {"id":"111","subject":"连衣裙","price":"45.00","quantityBegin":"2",
       "vagueSaleQuantity":"3200","memberId":"b2b-1",
       "offerImages":[{"imageURI":"//cbu01.alicdn.com/img/1.jpg"}]}
    ]}}})`;
    mockFetchOnce(jsonp);

    const items = await fetchShopProducts(cookies, "b2b-1");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      offerId: "111",
      title: "连衣裙",
      priceText: "45.00",
      moq: "2",
      sales: "3200",
      url: "https://detail.1688.com/offer/111.html",
    });
    expect(items[0]!.images[0]).toBe("https://cbu01.alicdn.com/img/1.jpg");
  });

  it("空 offerList 返回空数组", async () => {
    mockFetchOnce(`mtopjsonp1({"ret":["SUCCESS::调用成功"],"data":{"content":{}}})`);
    expect(await fetchShopProducts(cookies, "b2b-1")).toEqual([]);
  });
});

describe("fetchShopProductsFromPages", () => {
  it("从新版店铺页面提取商品链接", async () => {
    mockFetchOnce(`
      <html>
        <a href="https://detail.1688.com/offer/1035456382550.html" title="夏季衬衫">商品</a>
        <a href="//detail.1688.com/offer/1064580243161.html">商品</a>
      </html>
    `);

    const items = await fetchShopProductsFromPages(cookies, "https://shop039459ce98570.1688.com", 10);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      offerId: "1035456382550",
      title: "夏季衬衫",
      url: "https://detail.1688.com/offer/1035456382550.html",
    });
  });
});
