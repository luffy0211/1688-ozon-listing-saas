import {
  buildCompetitorBenchmarks,
  type OzonCategoryCompetitorResult,
  type OzonCompetitorTarget,
  type OzonPublicProduct,
} from "./ozon-public-crawler";

type IndexedResult = {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
};

const ATTRIBUTE_NAMES = [
  "Тип",
  "Пол",
  "Сезон",
  "Материал",
  "Состав материала",
  "Коллекция",
  "Стиль",
  "Рисунок",
  "Тип рукава",
  "Вырез горловины",
  "Назначение",
  "Рост",
  "Размер на модели",
  "Цвет товара",
];
const SECTION_NAMES = new Set(["О товаре", "Описание", "Отзывы", "Вопросы", "Характеристики", "Фото и видео покупателей"]);

function cleanLine(value: string) {
  return value.replace(/^\s*(?:#{1,6}|[-*])\s*/, "").trim();
}

function productSku(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.replace(/^www\./, "") !== "ozon.ru" || !parsed.pathname.startsWith("/product/")) return null;
    return parsed.pathname.match(/-(\d+)\/?$/)?.[1] ?? parsed.pathname.match(/\/product\/(\d+)\/?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function numberFromText(value: string) {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractAttributes(lines: string[]) {
  return Object.fromEntries(ATTRIBUTE_NAMES.flatMap((name) => {
    const index = lines.findIndex((line) => line === name || line.startsWith(`${name}:`));
    if (index < 0) return [];
    const inline = lines[index]!.slice(name.length + 1).trim();
    const next = lines[index + 1];
    const value = inline || (next && !ATTRIBUTE_NAMES.includes(next) && !SECTION_NAMES.has(next) ? next : null);
    return value ? [[name, value]] : [];
  }));
}

function extractDescription(lines: string[]) {
  const start = lines.findIndex((line) => line === "Описание");
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && SECTION_NAMES.has(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").slice(0, 4_000) || null;
}

export function parseIndexedOzonProduct(result: IndexedResult, position: number): OzonPublicProduct | null {
  if (!result.url) return null;
  const sku = productSku(result.url);
  if (!sku) return null;
  const text = result.raw_content || result.content || "";
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const ratingMatch = text.match(/(\d[.,]\d)\s*[•·]\s*([\d\s]+)\s*(?:отзыв|оцен)/i);
  const priceMatch = text.match(/([\d][\d\s]*)\s*₽/);
  return {
    sku,
    url: new URL(result.url).origin + new URL(result.url).pathname,
    title: cleanLine(result.title ?? sku).replace(/\s+купить\s+на\s+OZON.*$/i, ""),
    priceRub: priceMatch ? numberFromText(priceMatch[1]!) : null,
    oldPriceRub: null,
    rating: ratingMatch ? numberFromText(ratingMatch[1]!) : null,
    reviewCount: ratingMatch ? numberFromText(ratingMatch[2]!) : null,
    sellerName: null,
    imageUrls: [],
    attributes: extractAttributes(lines),
    description: extractDescription(lines),
    reviews: [],
    categoryPosition: position,
  };
}

function searchLabel(title: string) {
  if (/поло/i.test(title)) return "Мужское поло";
  if (/рубаш/i.test(title)) return "Мужская рубашка";
  if (/худи|толстов/i.test(title)) return "Мужское худи";
  return title.split(",")[0]!.slice(0, 100);
}

function emptyOwnProduct(target: OzonCompetitorTarget): OzonPublicProduct {
  const sku = target.publicSku ?? target.offerId;
  return {
    sku,
    url: target.publicSku ? `https://www.ozon.ru/product/${target.publicSku}/` : "",
    title: target.title,
    priceRub: null,
    oldPriceRub: null,
    rating: null,
    reviewCount: null,
    sellerName: null,
    imageUrls: [],
    attributes: {},
    description: null,
    reviews: [],
  };
}

export async function searchOzonIndexedCompetitors(params: {
  apiKey: string;
  targets: OzonCompetitorTarget[];
  ownSkus: Set<string>;
  limitPerProduct?: number;
  fetchImpl?: typeof fetch;
}): Promise<OzonCategoryCompetitorResult[]> {
  if (!params.apiKey) throw new Error("tavily_api_key_missing");
  const fetchImpl = params.fetchImpl ?? fetch;
  const results: OzonCategoryCompetitorResult[] = [];

  for (const target of params.targets) {
    const label = searchLabel(target.title);
    const category = {
      name: label,
      url: `https://www.ozon.ru/search/?text=${encodeURIComponent(label)}`,
      path: ["Ozon 搜索索引", label],
    };
    const fallback = emptyOwnProduct(target);
    try {
      const response = await fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${params.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          query: `site:ozon.ru/product/ ${label} О товаре Материал Состав материала`,
          include_domains: ["ozon.ru"],
          include_raw_content: "text",
          search_depth: "advanced",
          chunks_per_source: 3,
          max_results: 10,
        }),
      });
      if (!response.ok) throw new Error(`tavily_search_failed:${response.status}`);
      const payload: unknown = await response.json();
      const searchResults = payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as { results?: unknown }).results
        : null;
      if (!Array.isArray(searchResults)) throw new Error("tavily_invalid_results");
      const indexed = searchResults
        .flatMap((item, index) => item && typeof item === "object" ? [parseIndexedOzonProduct(item as IndexedResult, index + 1)] : [])
        .filter((item): item is OzonPublicProduct => Boolean(item))
        .filter((item, index, items) => items.findIndex((candidate) => candidate.sku === item.sku) === index);
      const ownProduct = indexed.find((item) => item.sku === target.publicSku) ?? fallback;
      const competitors = indexed
        .filter((item) => !params.ownSkus.has(item.sku))
        .slice(0, params.limitPerProduct ?? 5);
      results.push({
        target,
        category,
        ownProduct,
        competitors,
        benchmarks: competitors.length ? buildCompetitorBenchmarks(ownProduct, competitors) : null,
        warnings: competitors.length ? [] : ["搜索索引没有返回有效 Ozon 竞品"],
      });
    } catch (error) {
      results.push({
        target,
        category,
        ownProduct: fallback,
        competitors: [],
        benchmarks: null,
        warnings: [`搜索失败：${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }
  return results;
}
