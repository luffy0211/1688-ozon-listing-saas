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
    const productSlug = parsed.pathname.match(/^\/product\/([^/]+)/)?.[1];
    return productSlug?.match(/(?:^|-)(\d+)$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function numberFromText(value: string) {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractInlinePairs(text: string) {
  const matches = [...text.matchAll(/(?:^|[.!?;]\s+)([\p{Lu}][\p{L}\p{N}\s,()/%+№-]{0,79}):\s*/gu)];
  return Object.fromEntries(matches.flatMap((match, index) => {
    const name = match[1]?.trim();
    const next = matches[index + 1];
    const value = text.slice(match.index + match[0].length, next?.index ?? text.length)
      .trim()
      .replace(/[.!?;]+$/u, "")
      .trim();
    return name && value && name.split(/\s+/).length <= 8 && value.length <= 500
      ? [[name, value]]
      : [];
  }));
}

function extractAttributes(lines: string[], text: string) {
  const inline = Object.fromEntries(
    Object.entries(extractInlinePairs(text)).filter(([name]) => !SECTION_NAMES.has(name)),
  );
  const known = Object.fromEntries(ATTRIBUTE_NAMES.flatMap((name) => {
    const index = lines.findIndex((line) => line === name || line.startsWith(`${name}:`));
    if (index < 0) return [];
    const inline = lines[index]!.slice(name.length + 1).trim();
    const next = lines[index + 1];
    const value = inline || (next && !ATTRIBUTE_NAMES.includes(next) && !SECTION_NAMES.has(next) ? next : null);
    return value ? [[name, value]] : [];
  }));
  const start = lines.findIndex((line) => /^Характеристики(?: товара)?$/i.test(line));
  if (start < 0) return { ...known, ...inline };
  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => SECTION_NAMES.has(line));
  const candidates = section.slice(0, end < 0 ? undefined : end);
  const dynamic: Record<string, string> = {};
  for (let index = 0; index < candidates.length; index += 2) {
    const name = candidates[index];
    const value = candidates[index + 1];
    if (!name || !value || name.length > 100 || value.length > 500) continue;
    dynamic[name.replace(/:$/, "").trim()] = value.trim();
  }
  return { ...dynamic, ...known, ...inline };
}

function extractDescription(lines: string[], text: string) {
  const inline = extractInlinePairs(text).Описание;
  if (inline) return inline.slice(0, 4_000);
  const start = lines.findIndex((line) => line === "Описание");
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && SECTION_NAMES.has(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").slice(0, 4_000) || null;
}

export function parseIndexedOzonProduct(result: IndexedResult, position: number): OzonPublicProduct | null {
  if (!result.url) return null;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(result.url);
  } catch {
    return null;
  }
  if (/\/(?:reviews|questions)(?:\/|$)/i.test(parsedUrl.pathname)) return null;
  const sku = productSku(result.url);
  if (!sku) return null;
  const productSlug = parsedUrl.pathname.match(/^\/product\/([^/]+)/)?.[1];
  if (!productSlug) return null;
  const text = result.raw_content || result.content || "";
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const ratingMatch = text.match(/(\d[.,]\d)\s*[•·]\s*([\d\s]+)\s*(?:отзыв|оцен)/i);
  const priceMatch = text.match(/([\d][\d\s]*)\s*₽/);
  return {
    sku,
    url: `https://www.ozon.ru/product/${productSlug}/`,
    title: cleanLine(result.title ?? sku).replace(/\s+купить\s+на\s+OZON.*$/i, ""),
    priceRub: priceMatch ? numberFromText(priceMatch[1]!) : null,
    oldPriceRub: null,
    rating: ratingMatch ? numberFromText(ratingMatch[1]!) : null,
    reviewCount: ratingMatch ? numberFromText(ratingMatch[2]!) : null,
    sellerName: null,
    imageUrls: [],
    attributes: extractAttributes(lines, text),
    description: extractDescription(lines, text),
    reviews: [],
    categoryPosition: position,
  };
}

export function uniqueUsableIndexedCompetitors(products: OzonPublicProduct[]) {
  const seen = new Set<string>();
  return products.filter((product) => {
    const hasEvidence = Object.values(product.attributes).some((value) => value.trim()) || Boolean(product.description?.trim());
    if (!hasEvidence || seen.has(product.sku)) return false;
    seen.add(product.sku);
    return true;
  });
}

function normalizedCategoryTerm(value: string) {
  const term = value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  if (/^муж/.test(term)) return "__male__";
  if (/^жен/.test(term)) return "__female__";
  if (/^(?:дет|мальч|девоч)/.test(term)) return "__child__";
  const stem = term.replace(/(?:иями|ями|ами|ого|ему|ими|ыми|ая|яя|ое|ее|ый|ий|ой|ые|ие|ых|их|ую|юю|ом|ем|ам|ям|ах|ях|ов|ев|ей|ы|и|а|я|у|ю|е|о)$/u, "");
  return stem.length >= 4 ? stem : term;
}

function categoryTerms(value: string) {
  const ignored = new Set(["товар", "товары", "одежда", "обувь", "аксессуары", "для", "и"]);
  return [...new Set(
    (value.match(/[\p{L}\p{N}]+/gu) ?? [])
      .map(normalizedCategoryTerm)
      .filter((term) => term.length >= 3 && !ignored.has(term)),
  )];
}

function matchesTargetCategory(result: IndexedResult, target: OzonCompetitorTarget) {
  if (!target.categoryNameRu) return false;
  const titleTerms = new Set(categoryTerms(result.title ?? ""));
  const typeAlternatives = target.categoryNameRu
    .split(/\s+(?:и|или)\s+|[,/]+/iu)
    .map(categoryTerms)
    .filter((terms) => terms.length > 0);
  if (!typeAlternatives.some((terms) => terms.every((term) => titleTerms.has(term)))) return false;
  const genderTerms = categoryTerms((target.categoryPathRu ?? []).join(" "))
    .filter((term) => /^__(?:male|female|child)__$/.test(term));
  return genderTerms.every((term) => titleTerms.has(term));
}

function categorySearchLabel(target: OzonCompetitorTarget) {
  return [...new Set([...(target.categoryPathRu ?? []).slice(-2), target.categoryNameRu].filter(Boolean))]
    .join(" ");
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
  const grouped = new Map<string, OzonCompetitorTarget[]>();

  params.targets.forEach((target) => {
    if (!target.descriptionCategoryId || !target.typeId || !target.categoryNameRu) {
      results.push({
        target,
        category: null,
        ownProduct: emptyOwnProduct(target),
        competitors: [],
        benchmarks: null,
        warnings: ["自家商品缺少 Ozon 官方类目名称，已跳过竞品搜索"],
      });
      return;
    }
    const key = `${target.descriptionCategoryId}:${target.typeId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), target]);
  });

  for (const targets of grouped.values()) {
    const target = targets[0]!;
    const label = categorySearchLabel(target);
    const category = {
      name: target.categoryNameRu!,
      url: `https://www.ozon.ru/search/?text=${encodeURIComponent(label)}`,
      path: target.categoryPathRu ?? [target.categoryNameRu!],
    };
    try {
      const response = await fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${params.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          query: `site:ozon.ru/product/ ${label} Характеристики Описание`,
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
      const parsed = searchResults
        .flatMap((item, index) => item && typeof item === "object" ? [parseIndexedOzonProduct(item as IndexedResult, index + 1)] : [])
        .filter((item): item is OzonPublicProduct => Boolean(item));
      const indexed = uniqueUsableIndexedCompetitors(parsed);
      const emptyEvidenceCount = new Set(parsed.filter((item) =>
        !Object.values(item.attributes).some((value) => value.trim()) && !item.description?.trim(),
      ).map((item) => item.sku)).size;
      const competitors = indexed
        .filter((item) => matchesTargetCategory({ title: item.title }, target))
        .filter((item) => !params.ownSkus.has(item.sku))
        .slice(0, params.limitPerProduct ?? 5);
      const rejectedCount = indexed.filter((item) => !matchesTargetCategory({ title: item.title }, target)).length;
      targets.forEach((currentTarget) => {
        const ownProduct = indexed.find((item) => item.sku === currentTarget.publicSku) ?? emptyOwnProduct(currentTarget);
        const warnings = [
          ...(rejectedCount ? [`已过滤 ${rejectedCount} 个无法证明属于 ${target.categoryNameRu} 的搜索结果`] : []),
          ...(emptyEvidenceCount ? [`已过滤 ${emptyEvidenceCount} 个缺少有效属性和描述的搜索结果`] : []),
          ...(!competitors.length ? ["搜索索引没有返回有效同类目 Ozon 竞品"] : []),
        ];
        results.push({
          target: currentTarget,
          category,
          ownProduct,
          competitors,
          benchmarks: competitors.length ? buildCompetitorBenchmarks(ownProduct, competitors) : null,
          warnings,
        });
      });
    } catch (error) {
      targets.forEach((currentTarget) => results.push({
        target: currentTarget,
        category,
        ownProduct: emptyOwnProduct(currentTarget),
        competitors: [],
        benchmarks: null,
        warnings: [`搜索失败：${error instanceof Error ? error.message : String(error)}`],
      }));
    }
  }
  return results;
}
