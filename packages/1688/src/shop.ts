import type { CookieRecord, ShopProductItem } from "./types";
import { asRecord, mtopPost } from "./mtop";
import { cookieHeader } from "./cookie";
import { clean1688Title } from "./product";

const PC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 仅允许 1688.com 及其子域，拒绝 IP 字面量 / localhost / 私网（防 SSRF + cookie 外泄）。 */
export function is1688Host(hostname: string): boolean {
  const h = (hostname ?? "").toLowerCase();
  if (!h) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return false;
  return h === "1688.com" || h.endsWith(".1688.com");
}

/** 校验并返回 URL；非 1688 域名抛错。 */
export function assertSafe1688Url(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("店铺链接格式非法");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("仅支持 http/https 链接");
  }
  if (!is1688Host(u.hostname)) {
    throw new Error("仅支持 1688.com 域名的店铺链接");
  }
  return u;
}

/**
 * 把店铺输入归一化为 memberId（"b2b-{字母数字}"）。
 * 支持：直接 memberId、含 memberId= 的 URL、或店铺页（请求页面提取）。
 * 仅访问 1688.com 域名；重定向只在 1688 域内跟随（避免 cookie 跨域外泄）。
 */
export async function resolveMemberId(
  shopInput: string,
  cookies: CookieRecord,
): Promise<string> {
  const s = (shopInput ?? "").trim();
  if (!s) return "";
  if (/^b2b-[a-z0-9]+$/i.test(s)) return s;

  const m = s.match(/memberId=([^&"'\s]+)/i);
  if (m?.[1]) return m[1].trim();

  if (s.startsWith("http")) {
    const u = assertSafe1688Url(s);
    const headers = {
      "User-Agent": PC_UA,
      Referer: "https://www.1688.com/",
      Cookie: cookieHeader(cookies),
    };

    const urls = [u];
    if (!u.pathname || u.pathname === "/") {
      urls.push(new URL("/page/index.html", u));
    }

    for (const candidate of urls) {
      let html = "";
      const res = await fetch(candidate.toString(), { headers, redirect: "manual" });
      if ([301, 302, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (loc && is1688Host(new URL(loc, candidate).hostname)) {
          const r2 = await fetch(new URL(loc, candidate).toString(), { headers, redirect: "manual" });
          html = await r2.text();
        }
      } else {
        html = await res.text();
      }
      const mm =
        html.match(/"memberId"\s*:\s*"(b2b-[a-z0-9]+)"/i) ??
        html.match(/[?&]memberId=(b2b-[a-z0-9]+)/i);
      if (mm?.[1]) return mm[1];
    }
  }
  return "";
}

function absoluteCdn(url: string): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("//")) return `https:${u}`;
  return `https://cbu01.alicdn.com/${u.replace(/^\//, "")}`;
}

function normalize1688Url(url: string, base: URL): string {
  const value = (url ?? "").trim().replace(/\\\//g, "/");
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function collectOfferListPages(html: string, base: URL): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/["']([^"']*\/page\/offerlist[^"']*\.htm[^"']*)["']/gi)) {
    const url = normalize1688Url(decodeHtmlEntity(match[1] ?? ""), base);
    if (url) urls.add(url);
  }
  return [...urls].slice(0, 20);
}

function parseOfferLinks(html: string): ShopProductItem[] {
  const decoded = decodeHtmlEntity(html);
  const byOfferId = new Map<string, ShopProductItem>();
  for (const match of decoded.matchAll(/(?:https?:)?\/\/detail\.1688\.com\/offer\/(\d+)\.html[^"'\s<]*/gi)) {
    const offerId = match[1];
    if (!offerId || byOfferId.has(offerId)) continue;
    const start = Math.max(0, (match.index ?? 0) - 500);
    const end = Math.min(decoded.length, (match.index ?? 0) + 1000);
    const nearby = decoded.slice(start, end);
    const title =
      nearby.match(/(?:title|subject|offerTitle)"?\s*[:=]\s*"([^"]{2,160})"/i)?.[1] ??
      nearby.match(/title=["']([^"']{2,160})["']/i)?.[1] ??
      `1688 商品 ${offerId}`;
    const image =
      nearby.match(/(?:https?:)?\/\/[^"'\s<>]+?alicdn\.com[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)/i)?.[0] ??
      "";
    byOfferId.set(offerId, {
      offerId,
      title: clean1688Title(decodeHtmlEntity(title), `1688 商品 ${offerId}`),
      priceText: "",
      moq: "1",
      sales: "0",
      memberId: "",
      images: image ? [absoluteCdn(image)] : [],
      url: `https://detail.1688.com/offer/${offerId}.html`,
    });
  }
  return [...byOfferId.values()];
}

/** 提取店铺名：先试页面 <title>，失败回退到 URL slug。不带 cookie（避免登录态随请求外发）。 */
export async function fetchShopName(
  _cookies: CookieRecord,
  shopUrl: string,
): Promise<string> {
  try {
    const u = assertSafe1688Url(shopUrl);
    const headers = {
      "User-Agent": PC_UA,
      Referer: "https://www.1688.com/",
    };
    let html = "";
    const res = await fetch(u.toString(), { headers, redirect: "manual" });
    if ([301, 302, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (loc && is1688Host(new URL(loc, u).hostname)) {
        const r2 = await fetch(new URL(loc, u).toString(), { headers, redirect: "manual" });
        html = await r2.text();
      }
    } else {
      html = await res.text();
    }
    const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const name = (m?.[1] ?? "")
      .replace(/[-_|].*$/, "")
      .replace(/1688|阿里巴巴|厂家直销|实力商家/gi, "")
      .trim();
    if (name) return name.slice(0, 100);
  } catch {
    /* fallthrough */
  }
  try {
    const host = new URL(shopUrl).hostname.split(".")[0];
    if (host && host !== "www") return host;
  } catch {
    /* fallthrough */
  }
  return "未知店铺";
}

/** 页面兜底采集：部分 2025 新版店铺 mtop 模块返回空，但 PC 页面仍包含商品链接。 */
export async function fetchShopProductsFromPages(
  cookies: CookieRecord,
  shopUrl: string,
  limit = 50,
): Promise<ShopProductItem[]> {
  const u = assertSafe1688Url(shopUrl);
  const headers = {
    "User-Agent": PC_UA,
    Referer: "https://www.1688.com/",
    Cookie: cookieHeader(cookies),
  };
  const firstUrl = !u.pathname || u.pathname === "/" ? new URL("/page/index.html", u) : u;
  const pages = [firstUrl.toString()];
  const out = new Map<string, ShopProductItem>();

  for (let i = 0; i < pages.length && out.size < limit; i++) {
    const pageUrl = pages[i];
    if (!pageUrl) continue;
    const page = new URL(pageUrl);
    const res = await fetch(page.toString(), { headers, redirect: "manual" });
    if (!res.ok && ![301, 302, 307, 308].includes(res.status)) continue;
    let html = "";
    if ([301, 302, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) continue;
      const next = new URL(loc, page);
      if (!is1688Host(next.hostname)) continue;
      const redirected = await fetch(next.toString(), { headers, redirect: "manual" });
      html = await redirected.text();
    } else {
      html = await res.text();
    }

    for (const item of parseOfferLinks(html)) {
      if (!out.has(item.offerId)) out.set(item.offerId, item);
      if (out.size >= limit) break;
    }
    for (const offerListUrl of collectOfferListPages(html, page)) {
      if (!pages.includes(offerListUrl) && pages.length < 12) pages.push(offerListUrl);
    }
  }

  return [...out.values()].slice(0, limit);
}

/**
 * 店铺商品列表：mtop.1688.shop.data.get（零浏览器）。
 * memberId 为商家 ID（b2b-xxx）。
 */
export async function fetchShopProducts(
  cookies: CookieRecord,
  memberId: string,
): Promise<ShopProductItem[]> {
  const data = {
    dataType: "moduleData",
    argString: JSON.stringify({
      memberId,
      appName: "pcmodules",
      resourceName: "wpOfferDisplayWindow",
    }),
  };
  const resp = await mtopPost(cookies, "mtop.1688.shop.data.get", data);

  const content = asRecord(asRecord(resp["data"])["content"]);
  const offerList = content["offerList"];
  if (!Array.isArray(offerList)) return [];

  const out: ShopProductItem[] = [];
  for (const o of offerList) {
    if (!o || typeof o !== "object") continue;
    const offerId = String((o as Record<string, unknown>)["id"] ?? "");
    if (!offerId) continue;

    const images: string[] = [];
    const offerImages = (o as Record<string, unknown>)["offerImages"];
    if (Array.isArray(offerImages)) {
      for (const im of offerImages) {
        if (im && typeof im === "object") {
          const uri = (im as Record<string, unknown>)["imageURI"];
          if (typeof uri === "string") images.push(absoluteCdn(uri));
        } else if (typeof im === "string") {
          images.push(absoluteCdn(im));
        }
      }
    }

    out.push({
      offerId,
      title: String((o as Record<string, unknown>)["subject"] ?? "").trim(),
      priceText: String(
        (o as Record<string, unknown>)["price"] ??
          (o as Record<string, unknown>)["consignPrice"] ??
          "",
      ),
      moq: String((o as Record<string, unknown>)["quantityBegin"] ?? "1"),
      sales: String(
        (o as Record<string, unknown>)["vagueSaleQuantity"] ??
          (o as Record<string, unknown>)["thirtySaleQuantity"] ??
          0,
      ),
      memberId: String((o as Record<string, unknown>)["memberId"] ?? memberId),
      images,
      url: `https://detail.1688.com/offer/${offerId}.html`,
    });
  }
  return out;
}
