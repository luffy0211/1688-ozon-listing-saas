import {
  buildCompetitorBenchmarks,
  inferOzonCategoryName,
  isUsableCompetitorEvidence,
  ownOzonProduct,
  ozonCdnImageUrl,
  type OzonCategoryCompetitorResult,
  type OzonCompetitorTarget,
  type OzonPublicProduct,
} from "./ozon-public-crawler";

const ACTOR_URL = "https://api.apify.com/v2/acts/zen-studio~ozon-scraper-pro/run-sync-get-dataset-items";

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
}): Promise<OzonCategoryCompetitorResult[]> {
  if (!params.apiToken) throw new Error("apify_api_token_missing");
  const fetchImpl = params.fetchImpl ?? fetch;
  const results: OzonCategoryCompetitorResult[] = [];
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
      results.push({ target, category: null, ownProduct, competitors: [], benchmarks: null, warnings: ["自家商品缺少官方二级类目"] });
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
      const competitors = items.flatMap((item, index) => parseApifyOzonProduct(item, index + 1) ?? [])
        .filter((product) => {
          const type = product.attributes["Тип"]?.toLocaleLowerCase("ru-RU") ?? "";
          return type.includes(categoryName.toLocaleLowerCase("ru-RU")) &&
            !params.ownSkus.has(product.sku) &&
            isUsableCompetitorEvidence(product, target);
        })
        .slice(0, params.limitPerProduct);
      results.push({
        target,
        category,
        ownProduct,
        competitors,
        benchmarks: competitors.length ? buildCompetitorBenchmarks(ownProduct, competitors) : null,
        warnings: competitors.length ? [] : ["Apify 未返回可用的同类目竞品"],
      });
    } catch (error) {
      results.push({
        target,
        category,
        ownProduct,
        competitors: [],
        benchmarks: null,
        warnings: [`Apify 采集失败：${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }
  return results;
}
