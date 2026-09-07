const OZON_HOME = "https://www.ozon.ru/";
const COMPOSER_URL = "https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=";

type WidgetStates = Record<string, string>;
type JsonRecord = Record<string, unknown>;

export type OzonPublicCategory = {
  name: string;
  url: string;
  path: string[];
};

export type OzonPublicProduct = {
  sku: string;
  url: string;
  title: string;
  priceRub: number | null;
  oldPriceRub: number | null;
  rating: number | null;
  reviewCount: number | null;
  sellerName: string | null;
  imageUrls: string[];
  attributes: Record<string, string>;
  description: string | null;
  reviews: Array<{ rating: number | null; text: string }>;
  categoryPosition?: number;
};

export type OzonCompetitorTarget = {
  offerId: string;
  title: string;
  publicSku: string | null;
  quantity: number;
  revenueRub: number;
  descriptionCategoryId?: number | null;
  typeId?: number | null;
  categoryNameRu?: string | null;
  categoryPathRu?: string[];
};

export type OzonCategoryCompetitorResult = {
  target: OzonCompetitorTarget;
  category: OzonPublicCategory | null;
  ownProduct: OzonPublicProduct | null;
  competitors: OzonPublicProduct[];
  benchmarks: ReturnType<typeof buildCompetitorBenchmarks> | null;
  warnings: string[];
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function parsedStates(states: WidgetStates, keyPattern?: RegExp) {
  return Object.entries(states).flatMap(([key, raw]) => {
    if (keyPattern && !keyPattern.test(key)) return [];
    try {
      return [{ key, value: JSON.parse(raw) as unknown }];
    } catch {
      return [];
    }
  });
}

function walk(value: unknown, visit: (item: JsonRecord) => void) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  const item = record(value);
  if (!item) return;
  visit(item);
  Object.values(item).forEach((child) => walk(child, visit));
}

function stringField(item: JsonRecord, names: string[]) {
  for (const name of names) {
    const value = item[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberField(item: JsonRecord, names: string[]) {
  for (const name of names) {
    const value = item[name];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^\d,.-]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function absoluteOzonUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value, OZON_HOME);
    if (url.hostname.replace(/^www\./, "") !== "ozon.ru") return null;
    url.protocol = "https:";
    url.hostname = "www.ozon.ru";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function relativeOzonPath(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function productUrl(link: string | null, sku: string) {
  return absoluteOzonUrl(link) ?? `${OZON_HOME}product/${sku}/`;
}

function firstDeepNumber(value: unknown, names: string[]) {
  let result: number | null = null;
  walk(value, (item) => {
    if (result === null) result = numberField(item, names);
  });
  return result;
}

function firstDeepString(value: unknown, names: string[]) {
  let result: string | null = null;
  walk(value, (item) => {
    if (result === null) result = stringField(item, names);
  });
  return result;
}

function allImages(values: unknown[]) {
  const images = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      if (/^https:\/\//i.test(value) && /\.(?:avif|jpe?g|png|webp)(?:\?|$)/i.test(value)) {
        images.add(value);
      }
      return;
    }
    if (Array.isArray(value)) return value.forEach(collect);
    const item = record(value);
    if (item) Object.values(item).forEach(collect);
  };
  values.forEach(collect);
  return [...images].slice(0, 30);
}

function extractAttributes(values: unknown[]) {
  const attributes: Record<string, string> = {};
  values.forEach((value) => {
    walk(value, (item) => {
      const name = stringField(item, ["name", "title"]);
      const rawValues = item.values;
      if (!name || !Array.isArray(rawValues)) return;
      const text = rawValues
        .map((entry) => {
          const valueRecord = record(entry);
          return typeof entry === "string"
            ? entry
            : valueRecord
              ? stringField(valueRecord, ["text", "value", "name"])
              : null;
        })
        .filter((entry): entry is string => Boolean(entry))
        .join(", ");
      if (text) attributes[name] = text;
    });
  });
  return attributes;
}

export function extractSecondLevelCategory(states: WidgetStates): OzonPublicCategory | null {
  const links: Array<{ name: string; url: string }> = [];
  parsedStates(states, /bread/i).forEach(({ value }) => {
    walk(value, (item) => {
      const link = stringField(item, ["link", "href", "url"]);
      const name = stringField(item, ["text", "title", "name"]);
      const url = link?.includes("/category/") ? absoluteOzonUrl(link) : null;
      if (name && url && !links.some((entry) => entry.url === url)) links.push({ name, url });
    });
  });
  if (links.length < 2) return null;
  return { ...links[1]!, path: links.map((entry) => entry.name) };
}

function cardFromItem(item: JsonRecord, position: number): OzonPublicProduct | null {
  const sku = String(item.sku ?? item.id ?? "").trim();
  if (!sku) return null;
  const link = stringField(record(item.action) ?? {}, ["link", "url"]);
  const prices: number[] = [];
  walk(item.mainState, (state) => {
    Object.entries(state).forEach(([key, value]) => {
      if (/price/i.test(key)) {
        if (Array.isArray(value)) value.forEach((entry) => {
          const parsed = parseMoney(record(entry)?.text ?? entry);
          if (parsed !== null) prices.push(parsed);
        });
        const parsed = parseMoney(value);
        if (parsed !== null) prices.push(parsed);
      }
    });
  });
  const textState = Array.isArray(item.mainState)
    ? item.mainState.find((state) => record(state)?.id === "name")
    : null;
  const labels: string[] = [];
  walk(item.mainState, (state) => {
    const text = stringField(state, ["text"]);
    if (text) labels.push(text);
  });
  const ratingText = labels.find((text) => /^\d(?:[.,]\d)?$/.test(text));
  const reviewText = labels.find((text) => /отзыв|оцен/i.test(text));
  return {
    sku,
    url: productUrl(link, sku),
    title:
      firstDeepString(textState, ["text"]) ??
      stringField(item, ["title", "name"]) ??
      link?.split("/").at(-2)?.replace(/-\d+$/, "").replace(/-/g, " ") ??
      sku,
    priceRub: prices[0] ?? null,
    oldPriceRub: prices[1] ?? null,
    rating:
      firstDeepNumber(item.mainState, ["rating", "score", "totalScore"]) ??
      (ratingText ? Number(ratingText.replace(",", ".")) : null),
    reviewCount:
      firstDeepNumber(item.mainState, ["reviewCount", "reviewsCount", "commentsCount"]) ??
      parseMoney(reviewText),
    sellerName: null,
    imageUrls: allImages([item]),
    attributes: {},
    description: null,
    reviews: [],
    categoryPosition: position,
  };
}

export function extractCategoryProducts(states: WidgetStates, ownSkus = new Set<string>()) {
  const seen = new Set<string>();
  const products: OzonPublicProduct[] = [];
  for (const { value } of parsedStates(states, /tileGridDesktop|searchResultsV2/i)) {
    const container = record(value);
    if (!container || !Array.isArray(container.items)) continue;
    if (!container.items.some((entry) => record(entry)?.sku || record(entry)?.id)) continue;
    container.items.forEach((entry, index) => {
      const product = cardFromItem(record(entry) ?? {}, index + 1);
      if (!product || ownSkus.has(product.sku) || seen.has(product.sku)) return;
      seen.add(product.sku);
      products.push(product);
    });
    if (products.length) break;
  }
  return products;
}

function extractReviews(values: unknown[]) {
  const reviews: Array<{ rating: number | null; text: string }> = [];
  values.forEach((value) => {
    walk(value, (item) => {
      const content = record(item.content);
      const text = [
        content ? stringField(content, ["comment"]) : null,
        content ? stringField(content, ["positive"]) : null,
        content ? stringField(content, ["negative"]) : null,
      ].filter((entry): entry is string => Boolean(entry)).join("\n");
      if (text && !reviews.some((entry) => entry.text === text)) {
        reviews.push({ rating: numberField(content ?? item, ["score", "rating", "stars"]), text });
      }
    });
  });
  return reviews.slice(0, 20);
}

export function extractProductPage(states: WidgetStates, sku: string): OzonPublicProduct {
  const entries = parsedStates(states);
  const values = entries.map((entry) => entry.value);
  const heading = entries.find((entry) => /productHeading/i.test(entry.key))?.value;
  const priceWidget = entries.find((entry) => /webPrice|tilePrice/i.test(entry.key))?.value;
  const ratingWidget = entries.find((entry) => /reviewProductScore/i.test(entry.key))?.value;
  const sellerWidget = entries.find((entry) => /seller/i.test(entry.key))?.value;
  return {
    sku,
    url: `${OZON_HOME}product/${sku}/`,
    title: firstDeepString(heading, ["title", "name"]) ?? sku,
    priceRub: parseMoney(firstDeepString(priceWidget, ["price"]) ?? firstDeepNumber(priceWidget, ["cardPrice"])),
    oldPriceRub: parseMoney(firstDeepString(priceWidget, ["originalPrice", "oldPrice"])),
    rating: firstDeepNumber(ratingWidget, ["totalScore", "rating", "score"]),
    reviewCount: firstDeepNumber(ratingWidget, ["reviewsCount", "reviewCount"]),
    sellerName: firstDeepString(sellerWidget, ["sellerName", "name", "title"]),
    imageUrls: allImages(values),
    attributes: extractAttributes(entries.filter((entry) => /character|attribute/i.test(entry.key)).map((entry) => entry.value)),
    description: firstDeepString(entries.find((entry) => /description/i.test(entry.key))?.value, ["description", "text"]),
    reviews: extractReviews(entries.filter((entry) => /reviewList|webListReviews/i.test(entry.key)).map((entry) => entry.value)),
  };
}

export function mergeCategoryCardWithDetail(
  card: OzonPublicProduct,
  detail: OzonPublicProduct,
): OzonPublicProduct {
  return {
    ...card,
    attributes: Object.keys(detail.attributes).length ? detail.attributes : card.attributes,
    description: detail.description ?? card.description,
  };
}

function median(values: Array<number | null>) {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function titleTerms(title: string) {
  return title.toLocaleLowerCase("ru-RU").match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length >= 4) ?? [];
}

export function buildCompetitorBenchmarks(own: OzonPublicProduct, competitors: OzonPublicProduct[]) {
  const priceMedian = median(competitors.map((item) => item.priceRub));
  const termCounts = new Map<string, number>();
  const attributeCounts = new Map<string, number>();
  const attributeValueCounts = new Map<string, Map<string, number>>();
  competitors.forEach((item) => {
    new Set(titleTerms(item.title)).forEach((term) => termCounts.set(term, (termCounts.get(term) ?? 0) + 1));
    Object.entries(item.attributes).forEach(([name, value]) => {
      attributeCounts.set(name, (attributeCounts.get(name) ?? 0) + 1);
      const values = attributeValueCounts.get(name) ?? new Map<string, number>();
      new Set(value.split(/[,;|]+/).map((part) => part.trim()).filter(Boolean))
        .forEach((part) => values.set(part, (values.get(part) ?? 0) + 1));
      attributeValueCounts.set(name, values);
    });
  });
  const threshold = Math.max(2, Math.ceil(competitors.length / 2));
  const ownTerms = new Set(titleTerms(own.title));
  return {
    sampleSize: competitors.length,
    price: {
      ownRub: own.priceRub,
      medianRub: priceMedian,
      differenceRate: own.priceRub !== null && priceMedian ? (own.priceRub - priceMedian) / priceMedian : null,
    },
    rating: {
      median: median(competitors.map((item) => item.rating)),
      reviewCountMedian: median(competitors.map((item) => item.reviewCount)),
    },
    images: {
      ownCount: own.imageUrls.length,
      medianCount: median(competitors.map((item) => item.imageUrls.length)),
    },
    missingTitleTerms: [...termCounts.entries()]
      .filter(([term, count]) => count >= threshold && !ownTerms.has(term))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([term]) => term),
    missingAttributes: [...attributeCounts.entries()]
      .filter(([name, count]) => count >= threshold && !own.attributes[name])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name),
    content: {
      attributePatterns: [...attributeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, coverageCount]) => ({
          name,
          coverageCount,
          coverageRate: coverageCount / competitors.length,
          commonValues: [...(attributeValueCounts.get(name) ?? [])]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([value, count]) => ({ value, count })),
        })),
      descriptions: {
        availableCount: competitors.filter((item) => Boolean(item.description)).length,
        samples: competitors
          .filter((item): item is OzonPublicProduct & { description: string } => Boolean(item.description))
          .slice(0, 3)
          .map((item) => ({ sku: item.sku, title: item.title, text: item.description.slice(0, 500) })),
      },
    },
    reviewEvidence: competitors.flatMap((item) => item.reviews).slice(0, 30),
  };
}

export async function crawlOzonCategoryCompetitors(params: {
  targets: OzonCompetitorTarget[];
  ownSkus: Set<string>;
  limitPerProduct?: number;
}): Promise<OzonCategoryCompetitorResult[]> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ru-RU",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  try {
    await page.goto(OZON_HOME, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(5_000);
    const title = await page.title();
    if (/antibot|challenge|access denied|ограничен|нет соединения/i.test(title)) {
      throw new Error(`Ozon public page challenge: ${title}`);
    }
    const fetchJson = async (path: string) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await page.evaluate(async (url) => {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 12_000);
          try {
            const result = await fetch(url, {
              headers: { accept: "application/json" },
              signal: controller.signal,
            });
            return { status: result.status, text: await result.text() };
          } catch {
            return { status: 0, text: "" };
          } finally {
            window.clearTimeout(timeout);
          }
        }, `${COMPOSER_URL}${encodeURIComponent(path)}`);
        if (response.status === 200) {
          try { return JSON.parse(response.text) as { widgetStates?: WidgetStates }; } catch { /* retry */ }
        }
        await page.waitForTimeout(1_500);
      }
      return null;
    };
    const results: OzonCategoryCompetitorResult[] = [];
    for (const target of params.targets) {
      const warnings: string[] = [];
      if (!target.publicSku) {
        results.push({ target, category: null, ownProduct: null, competitors: [], benchmarks: null, warnings: ["自家商品缺少公开 SKU"] });
        continue;
      }
      const ownData = await fetchJson(`/product/${target.publicSku}/`);
      const ownStates = ownData?.widgetStates;
      const category = ownStates ? extractSecondLevelCategory(ownStates) : null;
      if (!ownStates || !category) {
        results.push({ target, category: null, ownProduct: null, competitors: [], benchmarks: null, warnings: ["无法读取自家商品二级类目"] });
        continue;
      }
      const ownProduct = extractProductPage(ownStates, target.publicSku);
      const categoryData = await fetchJson(relativeOzonPath(category.url));
      const cards = categoryData?.widgetStates
        ? extractCategoryProducts(categoryData.widgetStates, params.ownSkus).slice(0, 20)
        : [];
      const competitors: OzonPublicProduct[] = [];
      for (const card of cards.slice(0, params.limitPerProduct ?? 5)) {
        const detailData = await fetchJson(relativeOzonPath(card.url));
        if (!detailData?.widgetStates) {
          warnings.push(`竞品 ${card.sku} 详情读取失败，已使用类目卡片数据`);
          competitors.push(card);
          continue;
        }
        competitors.push(mergeCategoryCardWithDetail(
          card,
          extractProductPage(detailData.widgetStates, card.sku),
        ));
      }
      if (!competitors.length) warnings.push("同二级类目没有采集到有效竞品");
      results.push({
        target,
        category,
        ownProduct,
        competitors,
        benchmarks: competitors.length ? buildCompetitorBenchmarks(ownProduct, competitors) : null,
        warnings,
      });
    }
    return results;
  } finally {
    await browser.close();
  }
}
