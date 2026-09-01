import { AgentActionType, AgentRiskLevel, Prisma, prisma } from "@saas/db";
import { createAgentActions } from "./actions";

type JsonRecord = Record<string, unknown>;

export type CompetitorUrlKind = "product" | "store";

export type CompetitorContentSuggestion = {
  field: "title" | "description" | "attributes" | "keywords";
  sourceTag: "直接复用" | "借鉴改写" | "需要确认" | "禁止使用";
  current: string;
  suggestedRu: string;
  reasonZh: string;
  evidence: string[];
  confidence: number;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniq(values: string[]) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseOzonUrl(rawUrl: string): { kind: CompetitorUrlKind; url: string; sku?: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("请输入有效的 Ozon URL");
  }
  const host = url.hostname.replace(/^www\./, "");
  if (!["ozon.ru", "ozon.com"].includes(host)) {
    throw new Error("只支持 ozon.ru 或 ozon.com URL");
  }

  const path = url.pathname;
  const sku =
    path.match(/-(\d{6,})(?:\/)?$/)?.[1] ??
    path.match(/\/product\/(\d{6,})(?:\/)?$/)?.[1] ??
    undefined;
  if (path.includes("/product/")) return { kind: "product", url: url.toString(), sku };
  if (path.includes("/seller/") || path.includes("/shop/")) {
    return { kind: "store", url: url.toString() };
  }
  throw new Error("只支持 Ozon 商品页或店铺页 URL");
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match =
    html.match(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"));
  return match?.[1] ? decodeHtml(match[1]) : "";
}

function jsonLdRecords(html: string): JsonRecord[] {
  const records: JsonRecord[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1] ?? ""));
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) records.push(asRecord(item));
    } catch {
      // ignore invalid embedded data
    }
  }
  return records;
}

function collectProductLinks(html: string, baseUrl: string) {
  const links: string[] = [];
  const re = /href=["']([^"']*\/product\/[^"']+)["']/gi;
  for (const match of html.matchAll(re)) {
    const href = match[1];
    if (!href) continue;
    try {
      links.push(new URL(href, baseUrl).toString().split("?")[0]!);
    } catch {
      // ignore bad href
    }
  }
  return uniq(links).slice(0, 20);
}

async function fetchOzonHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
    },
  });
  if (!response.ok) throw new Error(`Ozon 页面采集失败: HTTP ${response.status}`);
  return response.text();
}

function parseProductHtml(url: string, html: string) {
  const jsonLd = jsonLdRecords(html).find((item) => text(item["@type"]).toLowerCase() === "product") ?? {};
  const aggregateRating = asRecord(jsonLd.aggregateRating);
  const offers = asRecord(Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers);
  const title =
    text(jsonLd.name) ||
    meta(html, "og:title") ||
    decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = text(jsonLd.description) || meta(html, "description") || meta(html, "og:description");
  const imageValues = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image, meta(html, "og:image")];
  const rating = Number(text(aggregateRating.ratingValue).replace(",", "."));
  const reviewCount = Number(text(aggregateRating.reviewCount));

  if (!title) throw new Error("未能从 Ozon 页面解析商品标题");

  return {
    title,
    priceText: text(offers.price) || meta(html, "product:price:amount"),
    rating: Number.isFinite(rating) ? rating : null,
    reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
    imageUrls: uniq(imageValues.map(text)),
    attributes: [],
    description,
    sellerName: text(asRecord(jsonLd.seller).name) || text(asRecord(jsonLd.brand).name) || null,
    rawJson: { url, jsonLd, meta: { title: meta(html, "og:title"), description: meta(html, "description") } },
  };
}

export async function collectCompetitorProductByUrl(tenantId: string, rawUrl: string) {
  const parsed = parseOzonUrl(rawUrl);
  if (parsed.kind !== "product") throw new Error("请输入 Ozon 商品 URL");
  const html = await fetchOzonHtml(parsed.url);
  const product = parseProductHtml(parsed.url, html);
  const now = new Date();

  const saved = await prisma.competitorProduct.upsert({
    where: { tenantId_url: { tenantId, url: parsed.url } },
    update: {
      sku: parsed.sku,
      title: product.title,
      sellerName: product.sellerName,
      priceText: product.priceText || null,
      rating: product.rating == null ? null : new Prisma.Decimal(product.rating),
      reviewCount: product.reviewCount,
      imageUrlsJson: product.imageUrls as never,
      attributesJson: product.attributes as never,
      description: product.description || null,
      rawJson: product.rawJson as never,
      lastCapturedAt: now,
    },
    create: {
      tenantId,
      url: parsed.url,
      sku: parsed.sku,
      title: product.title,
      sellerName: product.sellerName,
      priceText: product.priceText || null,
      rating: product.rating == null ? null : new Prisma.Decimal(product.rating),
      reviewCount: product.reviewCount,
      imageUrlsJson: product.imageUrls as never,
      attributesJson: product.attributes as never,
      description: product.description || null,
      rawJson: product.rawJson as never,
      lastCapturedAt: now,
    },
  });

  await prisma.competitorProductSnapshot.create({
    data: {
      tenantId,
      productId: saved.id,
      title: product.title,
      priceText: product.priceText || null,
      rating: product.rating == null ? null : new Prisma.Decimal(product.rating),
      reviewCount: product.reviewCount,
      imageUrlsJson: product.imageUrls as never,
      attributesJson: product.attributes as never,
      description: product.description || null,
      rawJson: product.rawJson as never,
      capturedAt: now,
    },
  });

  return saved;
}

export async function collectCompetitorStoreByUrl(tenantId: string, rawUrl: string) {
  const parsed = parseOzonUrl(rawUrl);
  if (parsed.kind !== "store") throw new Error("请输入 Ozon 店铺 URL");
  const html = await fetchOzonHtml(parsed.url);
  const title = meta(html, "og:title") || decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const store = await prisma.competitorStore.upsert({
    where: { tenantId_storeUrl: { tenantId, storeUrl: parsed.url } },
    update: { name: title || null, rawJson: { title } as never },
    create: { tenantId, storeUrl: parsed.url, name: title || null, rawJson: { title } as never },
  });
  const links = collectProductLinks(html, parsed.url);
  const products = [];
  for (const url of links.slice(0, 8)) {
    try {
      const product = await collectCompetitorProductByUrl(tenantId, url);
      await prisma.competitorProduct.update({
        where: { id: product.id },
        data: { competitorStoreId: store.id },
      });
      products.push(product);
    } catch {
      // keep partial store capture useful
    }
  }
  return { store, products };
}

function words(value: string) {
  return uniq(value.toLowerCase().match(/[a-zа-яё0-9-]{3,}/gi) ?? []).slice(0, 18);
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

async function myProductContent(
  tenantId: string,
  sourceProductId?: string | null,
  offerId?: string | null,
  storeId?: string | null,
) {
  if (sourceProductId || offerId) {
    const product = await prisma.sourceProduct.findFirst({
      where: { tenantId, ...(sourceProductId ? { id: sourceProductId } : { offerId: offerId! }) },
      include: { productFacts: { orderBy: { updatedAt: "desc" }, take: 1 } },
    });
    if (product) {
      return {
        sourceProductId: product.id,
        offerId: product.offerId,
        title: product.title ?? "",
        description: text(asRecord(product.productFacts[0]?.normalizedJson).descriptionText),
        attributes: asRecord(product.productFacts[0]?.normalizedJson),
      };
    }
  }

  const snapshot = await prisma.ozonProductSnapshot.findFirst({
    where: { tenantId, ...(offerId ? { offerId } : {}), ...(storeId ? { storeId } : {}) },
    orderBy: { updatedAt: "desc" },
  });
  return {
    sourceProductId: null,
    offerId: snapshot?.offerId ?? null,
    title: snapshot?.name ?? "",
    description: "",
    attributes: asRecord(snapshot?.rawJson),
  };
}

export async function runCompetitorContentAgent(params: {
  tenantId: string;
  userId: string;
  sessionId: string;
  runId: string;
  storeId?: string | null;
  sourceProductId?: string | null;
  offerId?: string | null;
  competitorUrls: string[];
}) {
  const captured = [];
  for (const rawUrl of params.competitorUrls.slice(0, 5)) {
    const parsed = parseOzonUrl(rawUrl);
    if (parsed.kind === "store") {
      const result = await collectCompetitorStoreByUrl(params.tenantId, rawUrl);
      captured.push(...result.products);
    } else {
      captured.push(await collectCompetitorProductByUrl(params.tenantId, rawUrl));
    }
  }

  const competitors = captured.slice(0, 10);
  if (!competitors.length) throw new Error("没有采集到可分析的竞品商品");

  const own = await myProductContent(
    params.tenantId,
    params.sourceProductId,
    params.offerId,
    params.storeId,
  );
  const competitorTitles = competitors.map((item) => item.title);
  const keywordPool = uniq(competitorTitles.flatMap(words)).slice(0, 12);
  const evidence = competitors.slice(0, 3).map((item) => `${item.title} (${item.url})`);
  const suggestedTitle = uniq([...keywordPool.slice(0, 8), own.title].filter(Boolean)).join(" ");
  const suggestedDescription = [
    own.description || own.title,
    keywordPool.length ? `Ключевые акценты: ${keywordPool.slice(0, 6).join(", ")}.` : "",
  ].filter(Boolean).join("\n");

  const suggestions: CompetitorContentSuggestion[] = [
    {
      field: "title",
      sourceTag: "借鉴改写",
      current: own.title,
      suggestedRu: suggestedTitle,
      reasonZh: "竞品标题普遍把品类词、季节/风格词和使用场景前置；建议把这些高频表达融合到自家标题里。",
      evidence,
      confidence: 0.72,
    },
    {
      field: "keywords",
      sourceTag: "直接复用",
      current: "",
      suggestedRu: keywordPool.join(", "),
      reasonZh: "这些是多个竞品标题或描述中出现的通用类目词/搜索词，可以直接用于关键词补充。",
      evidence,
      confidence: 0.8,
    },
    {
      field: "description",
      sourceTag: "借鉴改写",
      current: own.description,
      suggestedRu: suggestedDescription,
      reasonZh: "保留自家商品事实，只借鉴竞品的信息组织方式，避免复制整段竞品文案。",
      evidence,
      confidence: 0.68,
    },
  ];

  const report = await prisma.competitorContentReport.create({
    data: {
      tenantId: params.tenantId,
      competitorProductId: competitors[0]?.id,
      sourceProductId: own.sourceProductId,
      ozonOfferId: own.offerId,
      title: `竞品内容分析：${own.title || own.offerId || competitors[0]?.title}`,
      createdBy: params.userId,
      reportJson: {
        competitorProductIds: competitors.map((item) => item.id),
        competitorCount: competitors.length,
        titlePatterns: ["品类词 + 风格/季节 + 人群/场景", "核心卖点前置，参数后置"],
        keywords: keywordPool,
        evidence,
        suggestions,
      } as never,
    },
  });

  const actions = await createAgentActions({
    tenantId: params.tenantId,
    sessionId: params.sessionId,
    runId: params.runId,
    requestedBy: params.userId,
    actions: [
      {
        type: AgentActionType.CONTENT_DRAFT,
        title: `内容优化草稿：${own.title || own.offerId || "未命名商品"}`,
        rationale: `基于 ${competitors.length} 个 Ozon 竞品商品生成标题、关键词和描述建议。`,
        riskLevel: AgentRiskLevel.MEDIUM,
        storeId: params.storeId,
        offerId: own.offerId,
        productId: own.sourceProductId,
        payload: {
          reportId: report.id,
          current: own,
          suggestions,
          competitorProductIds: competitors.map((item) => item.id),
        },
      },
    ],
  });

  return {
    output: [
      `已采集 ${competitors.length} 个竞品商品，生成 1 份竞品内容报告。`,
      `高频关键词：${keywordPool.join("、") || "暂无"}`,
      "已创建 1 个 CONTENT_DRAFT，等待人工审批后再执行。",
    ].join("\n"),
    actions,
  };
}
