import {
  buildCompetitorBenchmarks,
  inferOzonCategoryName,
  ownOzonProduct,
  ozonCdnImageUrl,
  type OzonCategoryCompetitorResult,
  type OzonCompetitorTarget,
  type OzonPublicProduct,
} from "./ozon-public-crawler";
import { uniqueUsableIndexedCompetitors } from "./ozon-search-index";

const ACTOR_URL = "https://api.apify.com/v2/acts/zen-studio~ozon-scraper-pro/run-sync-get-dataset-items";

export type ApifyOzonCategoryResult = OzonCategoryCompetitorResult & {
  collectionState: "complete" | "partial" | "no_results" | "provider_failed" | "unavailable";
};

export function validateCompetitorSampleLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error("competitor_sample_limit_invalid");
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseApifyOzonProduct(value: unknown, categoryPosition: number): OzonPublicProduct | null {
  const item = record(value);
  const sku = text(item.sku);
  const url = text(item.url);
  const title = text(item.title);
  if (!sku || !url || !title) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname.replace(/^www\./, "") !== "ozon.ru" || !parsed.pathname.startsWith("/product/")) return null;
  } catch {
    return null;
  }
  const attributes = Object.fromEntries((Array.isArray(item.characteristics) ? item.characteristics : [])
    .flatMap((entry) => {
      const field = record(entry);
      const name = text(field.name);
      const value = text(field.value);
      return name && value ? [[name, value]] : [];
    }));
  const hashtags = Array.isArray(item.hashtags) ? item.hashtags.map(text).filter(Boolean) : [];
  if (hashtags.length) attributes["Хештеги"] = hashtags.join(" ");
  const imageUrls = [...new Set([item.coverImageUrl, ...(Array.isArray(item.images) ? item.images : [])]
    .flatMap((image) => ozonCdnImageUrl(image) ?? []))];
  return {
    sku,
    url,
    title,
    priceRub: number(item.cardPriceDecimal) ?? number(item.priceDecimal),
    oldPriceRub: number(item.originalPriceDecimal),
    rating: number(item.rating),
    reviewCount: number(item.reviewCount),
    sellerName: text(record(item.seller).name),
    imageUrls,
    attributes,
    description: text(item.richDescription) ?? text(item.description),
    reviews: [],
    categoryPosition,
  };
}

export async function searchOzonApifyCompetitors(params: {
  apiToken: string;
  targets: OzonCompetitorTarget[];
  ownSkus: Set<string>;
  limitPerProduct: number;
  fetchImpl?: typeof fetch;
}): Promise<ApifyOzonCategoryResult[]> {
  validateCompetitorSampleLimit(params.limitPerProduct);
  if (!params.apiToken) throw new Error("apify_api_token_missing");
  const fetchImpl = params.fetchImpl ?? fetch;
  const results: ApifyOzonCategoryResult[] = [];
  for (const target of params.targets) {
    const categoryName = inferOzonCategoryName(target);
    const ownProduct = ownOzonProduct(target);
    const query = [...new Set([...(target.categoryPathRu ?? []).slice(-2), categoryName].filter(Boolean))].join(" ");
    const category = categoryName && query ? {
      name: categoryName,
      url: `https://www.ozon.ru/search/?text=${encodeURIComponent(query)}`,
      path: target.categoryPathRu?.length ? target.categoryPathRu : [categoryName],
    } : null;
    if (!category || !categoryName || !target.descriptionCategoryId || !target.typeId) {
      results.push({ target, category: null, ownProduct, competitors: [], benchmarks: null, collectionState: "unavailable", warnings: ["自家商品缺少官方二级类目"] });
      continue;
    }
    try {
      const response = await fetchImpl(ACTOR_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${params.apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          queries: [query],
          maxResults: Math.min(20, Math.max(3, params.limitPerProduct + 2)),
          skipDetails: false,
          includeSellerDetails: false,
          reportUnavailable: false,
          language: "ru",
          currency: "RUB",
          sorting: "score",
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error(`Apify HTTP ${response.status}`);
      const items: unknown = await response.json();
      if (!Array.isArray(items)) throw new Error("Apify 返回格式不正确");
      const hasProviderErrors = items.some((item) => Boolean(record(item).error));
      const candidates = items.flatMap((item, index) => parseApifyOzonProduct(item, index + 1) ?? [])
        .filter((product) => {
          const type = product.attributes["Тип"]?.toLocaleLowerCase("ru-RU") ?? "";
          return type.includes(categoryName.toLocaleLowerCase("ru-RU")) &&
            !params.ownSkus.has(product.sku);
        });
      const competitors = uniqueUsableIndexedCompetitors(candidates, target)
        .slice(0, params.limitPerProduct);
      if (!competitors.length && hasProviderErrors) throw new Error("Apify 返回采集错误");
      const collectionState = !competitors.length ? "no_results"
        : competitors.length < params.limitPerProduct || hasProviderErrors ? "partial" : "complete";
      results.push({
        target,
        category,
        ownProduct,
        competitors,
        collectionState,
        benchmarks: competitors.length ? buildCompetitorBenchmarks(ownProduct, competitors) : null,
        warnings: collectionState === "no_results" ? ["Apify 未返回可用的同类目竞品"]
          : collectionState === "partial" ? [`Apify 仅返回部分可用竞品：${competitors.length}/${params.limitPerProduct}`] : [],
      });
    } catch (error) {
      results.push({
        target,
        category,
        ownProduct,
        competitors: [],
        collectionState: "provider_failed",
        benchmarks: null,
        warnings: [`Apify 采集失败：${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }
  return results;
}
