import type { CookieRecord, ProductDetail } from "./types";
import { asRecord, mtopPost } from "./mtop";
import { cookieHeader } from "./cookie";

const PC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type SkuProp = { prop: string; values: Array<{ name: string; imageUrl?: string }> };

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** 用括号平衡从 HTML 提取 `"key":[...]` 数组（属性值含中文括号，安全）。 */
export function extractJsonArray(html: string, key: string): unknown[] {
  const tag = `"${key}":`;
  const i = html.indexOf(tag);
  if (i === -1) return [];
  const j = html.indexOf("[", i);
  if (j === -1) return [];
  let depth = 0;
  for (let k = j; k < html.length; k++) {
    const c = html[k];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(j, k + 1));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

function firstMatch(html: string, pattern: RegExp): string {
  const m = html.match(pattern);
  return m?.[1] ?? "";
}

/** 解码 HTML 实体（1688 的 spec 键里 ">" 是 "&gt;"）。 */
export function decodeHtml(s: string): string {
  return s
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const badTitles = new Set(["大图轮播", "视频播放"]);

export function clean1688Title(title: string, fallback = ""): string {
  const cleaned = decodeHtml(title).replace(/\s+/g, " ").trim();
  if (!cleaned || badTitles.has(cleaned)) return fallback;
  return cleaned
    .replace(/\s*[-_|｜]\s*(阿里巴巴|1688).*$/i, "")
    .trim()
    .slice(0, 160);
}

function extractOfferTitle(html: string): string {
  return clean1688Title(
    firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
      firstMatch(html, /"subject"\s*:\s*"([^"]{2,160})"/i) ||
      firstMatch(html, /"offerTitle"\s*:\s*"([^"]{2,160})"/i) ||
      firstMatch(html, /<title[^>]*>([^<]{2,220})<\/title>/i),
  );
}

/** 直调 PC 详情页 HTML，提取完整属性 + 商家信息。 */
async function fetchOfferPage(
  cookies: CookieRecord,
  offerId: string,
): Promise<{ title: string; properties: Array<{ name: string; value: string }>; shopId: string; shopUrl: string; sellerLoginId: string; detailUrl: string; leafCategoryId?: number }> {
  const url = `https://detail.1688.com/offer/${offerId}.html`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": PC_UA,
      Referer: "https://www.1688.com/",
      Cookie: cookieHeader(cookies),
    },
    redirect: "follow",
  });
  const html = await res.text();

  const properties: Array<{ name: string; value: string }> = [];
  // 完整属性：新版页面在 offerDetail.featureAttributes；旧版在 decisionCpv/normalCpv（兜底）
  const featureAttrs = extractJsonArray(html, "featureAttributes");
  const attrItems =
    featureAttrs.length > 0
      ? featureAttrs
      : [...extractJsonArray(html, "decisionCpv"), ...extractJsonArray(html, "normalCpv")];
  for (const cpv of attrItems) {
    if (!cpv || typeof cpv !== "object") continue;
    const rec = cpv as Record<string, unknown>;
    const name = str(rec["name"]).trim();
    const values = rec["values"];
    if (name && Array.isArray(values) && values.length) {
      properties.push({ name, value: values.map(str).join("、") });
    } else if (name && rec["value"] != null && str(rec["value"])) {
      properties.push({ name, value: str(rec["value"]) });
    }
  }

  return {
    title: extractOfferTitle(html),
    properties,
    shopId: firstMatch(html, /"sellerMemberId":"([^"]+)"/),
    shopUrl: firstMatch(html, /"winportUrl":"([^"]+)"/),
    sellerLoginId: firstMatch(html, /"sellerLoginId":"([^"]+)"/),
    detailUrl: firstMatch(html, /"detailUrl":"([^"]+)"/),
    leafCategoryId: (() => {
      const m = html.match(/"leafCategoryId":(\d+)/);
      return m?.[1] ? Number(m[1]) : undefined;
    })(),
  };
}

/** 请求详情描述内容（itemcdn），提取详情图 URL 列表。 */
export async function fetchDetailImages(detailUrl: string): Promise<string[]> {
  if (!detailUrl) return [];
  try {
    const res = await fetch(detailUrl, {
      headers: { "User-Agent": PC_UA },
      redirect: "follow",
    });
    const body = await res.text();
    // 形如 var offer_details={"content":"<div>...<img src="..."/>..."};
    const m = body.match(/"content":"((?:[^"\\]|\\.)*)"/);
    if (!m?.[1]) return [];
    const content = m[1].replace(/\\"/g, '"').replace(/\\\//g, "/");
    const imgs = [...content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
      .map((x) => x[1])
      .filter((u): u is string => Boolean(u && (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("//"))));
    return [...new Set(imgs.map((u) => (u.startsWith("//") ? `https:${u}` : u)))];
  } catch {
    return [];
  }
}

/** 直调 mtop SKU 接口，拿规格/价格/库存/主图。 */
async function fetchSkuModel(
  cookies: CookieRecord,
  offerId: string,
): Promise<{
  skus: ProductDetail["skus"];
  skuImages: Record<string, string>;
  mainImages: string[];
  price: string;
  moq: string;
  sales: string;
  stock: string;
  shopName: string;
}> {
  const data = {
    offerId,
    useCase: "1688detail",
    bizScene: "pcod",
    urlParam: "actionType=dxOrder&sk=consign",
  };
  const resp = await mtopPost(cookies, "mtop.1688.wosc.queryOfferSkuSelectorModel", data);

  const model = asRecord(asRecord(resp["data"])["skuSelectorBizModel"]);
  const skuModel = asRecord(model["skuSelectorModel"]);

  // 属性维度 skuProps: {fid, prop, value:[{name, imageUrl}]}
  // 注意层级：skuProps / skuInfoMap 在 skuSelectorBizModel 层，mainImageList/tradeModel/sellerLoginId 在 skuSelectorModel 层
  const skuProps: SkuProp[] = [];
  const rawProps = model["skuProps"];
  if (Array.isArray(rawProps)) {
    for (const p of rawProps) {
      if (!p || typeof p !== "object") continue;
      const rec = p as Record<string, unknown>;
      const prop = str(rec["prop"]).trim();
      const values: SkuProp["values"] = [];
      const rawValues = rec["value"];
      if (Array.isArray(rawValues)) {
        for (const v of rawValues) {
          if (!v || typeof v !== "object") continue;
          const vr = v as Record<string, unknown>;
          values.push({ name: str(vr["name"]).trim(), imageUrl: str(vr["imageUrl"]) || undefined });
        }
      }
      if (prop && values.length) skuProps.push({ prop, values });
    }
  }

  const skuImages: Record<string, string> = {};
  for (const prop of skuProps) {
    for (const v of prop.values) {
      if (v.imageUrl && v.name) skuImages[v.name] = v.imageUrl;
    }
  }

  // 规格组合 skuInfoMap: {spec: {price, canBookCount, skuId, specAttrs}}
  const skus: ProductDetail["skus"] = [];
  const skuInfoMap = model["skuInfoMap"];
  // 维度名（如 颜色/尺码），用于把 "黑色>XL" 拆成 {颜色:黑色, 尺码:XL}
  const propNames = skuProps.map((p) => p.prop);
  if (skuInfoMap && typeof skuInfoMap === "object" && !Array.isArray(skuInfoMap)) {
    for (const [spec, info] of Object.entries(skuInfoMap as Record<string, unknown>)) {
      const ir = asRecord(info);
      // spec 格式 "颜色值&gt;尺码值"（HTML 实体分隔），先解码再按维度名映射
      const specDecoded = decodeHtml(spec);
      const parts = specDecoded.split(">");
      let attributes: Record<string, string>;
      if (propNames.length > 0 && parts.length === propNames.length) {
        attributes = {};
        parts.forEach((v, i) => {
          const n = propNames[i];
          if (n) attributes[n] = v;
        });
      } else {
        attributes = { spec: specDecoded };
      }
      const rawPrice = ir["price"];
      const priceCny =
        rawPrice != null && rawPrice !== "" ? Number(rawPrice) : undefined;
      skus.push({
        skuId: str(ir["skuId"]),
        name: specDecoded,
        attributes,
        priceCny: priceCny != null && Number.isFinite(priceCny) ? priceCny : undefined,
        stockText: ir["canBookCount"] != null ? str(ir["canBookCount"]) : undefined,
        imageUrl: undefined,
      });
    }
  }

  // 主图
  const mainImages: string[] = [];
  const rawImages = skuModel["mainImageList"];
  if (Array.isArray(rawImages)) {
    for (const im of rawImages) {
      const uri = im && typeof im === "object" ? (im as Record<string, unknown>)["fullPathImageURI"] : undefined;
      if (typeof uri === "string" && uri) mainImages.push(uri);
    }
  }

  const trade = asRecord(skuModel["tradeModel"]);
  return {
    skus,
    skuImages,
    mainImages,
    price: str(trade["minPrice"] ?? trade["priceDisplay"]),
    moq: str(trade["beginAmount"]),
    sales: str(trade["saleCount"]),
    stock: str(trade["canBookedAmount"]),
    shopName: str(skuModel["sellerLoginId"]),
  };
}

/** 拉取单商品详情：SKU 接口 + PC 详情页合并。 */
export async function fetchProductDetail(
  cookies: CookieRecord,
  offerId: string,
  titleFallback = "",
): Promise<ProductDetail> {
  const [sku, page] = await Promise.all([
    fetchSkuModel(cookies, offerId).catch((e) => {
      // SKU 接口失败不阻断详情页采集
      return { skus: [], skuImages: {}, mainImages: [], price: "", moq: "", sales: "", stock: "", shopName: "", error: e as Error };
    }),
    fetchOfferPage(cookies, offerId).catch(() => ({
      title: "",
      properties: [],
      shopId: "",
      shopUrl: "",
      sellerLoginId: "",
      detailUrl: "",
      leafCategoryId: undefined,
    })),
  ]);

  // 详情图：请求详情描述内容提取
  const detailImages = await fetchDetailImages(page.detailUrl ?? "");

  // 补充 SKU 图：颜色值关联图片
  const skuModel = sku as { skus: ProductDetail["skus"]; skuImages: Record<string, string> };
  const skus = skuModel.skus.map((s) => {
    const color = s.attributes["颜色"] ?? "";
    return { ...s, imageUrl: s.imageUrl ?? skuModel.skuImages[color] };
  });

  return {
    offerId,
    title: page.title || clean1688Title(titleFallback, `1688 商品 ${offerId}`),
    sourceUrl: `https://detail.1688.com/offer/${offerId}.html`,
    properties: page.properties,
    skus,
    mainImages: (sku as { mainImages: string[] }).mainImages,
    detailImages,
    leafCategoryId: page.leafCategoryId,
    categoryPath: [],
    price: (sku as { price: string }).price,
    moq: (sku as { moq: string }).moq,
    sales: (sku as { sales: string }).sales,
    stock: (sku as { stock: string }).stock,
    shopName: (sku as { shopName: string }).shopName || page.sellerLoginId,
    shopUrl: page.shopUrl,
    shopId: page.shopId,
  };
}
