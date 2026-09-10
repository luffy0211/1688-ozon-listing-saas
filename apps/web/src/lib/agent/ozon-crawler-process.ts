import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { env } from "../env";
import {
  buildCompetitorBenchmarks,
  type OzonCategoryCompetitorResult,
  type OzonCompetitorTarget,
  type OzonPublicProduct,
} from "./ozon-public-crawler";

const execFileAsync = promisify(execFile);

const competitorSchema = z.object({
  publicRank: z.number().int().positive(),
  sku: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  priceRub: z.number().nullable().optional(),
  rating: z.number().nullable().optional(),
  reviewCount: z.number().int().nullable().optional(),
  sellerName: z.string().nullable().optional(),
  attributes: z.record(z.string(), z.string()),
});

const crawlerOutputSchema = z.object({
  requestId: z.string(),
  capturedAt: z.string(),
  rankingType: z.literal("public_popularity_proxy"),
  categories: z.array(z.object({
    categoryKey: z.string(),
    scannedCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    filteredMismatchedCount: z.number().int().nonnegative(),
    filteredDemographicCount: z.number().int().nonnegative().optional(),
    missingDemographicCount: z.number().int().nonnegative().optional(),
    deduplicatedVariantCount: z.number().int().nonnegative().optional(),
    warnings: z.array(z.string()),
    competitors: z.array(competitorSchema),
  })),
});

type CrawlerOutput = z.infer<typeof crawlerOutputSchema>;
type CrawlerJobCategory = {
  categoryKey: string;
  descriptionCategoryId: number;
  typeId: number;
  categoryNameRu: string;
  productType: string;
  gender?: string;
  ageGroup?: string;
  ozonQuery?: string;
};

function categoryKey(target: OzonCompetitorTarget) {
  return target.descriptionCategoryId && target.typeId
    ? `${target.descriptionCategoryId}:${target.typeId}`
    : null;
}

function genderFromPath(pathParts: string[]) {
  const value = pathParts.join(" ").toLocaleLowerCase("ru-RU");
  if (value.includes("жен")) return "Женский";
  if (value.includes("дет") || value.includes("девоч") || value.includes("мальч")) return "Детский";
  if (value.includes("муж")) return "Мужской";
  return null;
}

function categorySearchQuery(name: string, gender: string | null, path: string[]) {
  if (!gender) return [...new Set([...path.slice(-2), name])].join(" ");
  const genderWord = gender === "Мужской"
    ? "мужские"
    : gender === "Женский"
      ? "женские"
      : "детские";
  return `${name} ${genderWord}`;
}

function ownProduct(target: OzonCompetitorTarget): OzonPublicProduct {
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

export function buildOzonCrawlerJob(params: {
  requestId: string;
  targets: OzonCompetitorTarget[];
  ownSkus: Set<string>;
  topN: number;
  scanPages: number;
}) {
  const seen = new Set<string>();
  const categories = params.targets.flatMap<CrawlerJobCategory>((target) => {
    const key = categoryKey(target);
    if (!key || !target.categoryNameRu || seen.has(key)) return [];
    seen.add(key);
    const categoryPath = target.categoryPathRu ?? [];
    const gender = genderFromPath(categoryPath);
    const category = {
      categoryKey: key,
      descriptionCategoryId: target.descriptionCategoryId!,
      typeId: target.typeId!,
      categoryNameRu: target.categoryNameRu,
      productType: target.categoryNameRu,
      ozonQuery: categorySearchQuery(target.categoryNameRu, gender, categoryPath),
    };
    if (!gender) {
      return [category];
    }
    return [{
      ...category,
      gender,
      ageGroup: gender === "Детский" ? "Дети" : "Взрослые",
    }];
  });
  return {
    requestId: params.requestId,
    topN: params.topN,
    scanPages: params.scanPages,
    categories,
    excludeSkus: [...params.ownSkus],
  };
}

function publicProduct(value: z.infer<typeof competitorSchema>): OzonPublicProduct {
  return {
    sku: value.sku,
    url: value.url,
    title: value.title,
    priceRub: value.priceRub ?? null,
    oldPriceRub: null,
    rating: value.rating ?? null,
    reviewCount: value.reviewCount ?? null,
    sellerName: value.sellerName ?? null,
    imageUrls: [],
    attributes: value.attributes,
    description: value.description ?? null,
    reviews: [],
    categoryPosition: value.publicRank,
  };
}

export function parseOzonCrawlerOutput(
  raw: unknown,
  targets: OzonCompetitorTarget[],
): OzonCategoryCompetitorResult[] {
  const output = crawlerOutputSchema.parse(raw);
  const byCategory = new Map(output.categories.map((item) => [item.categoryKey, item]));
  return targets.map((target) => {
    const key = categoryKey(target);
    const result = key ? byCategory.get(key) : null;
    const own = ownProduct(target);
    const competitors = (result?.competitors ?? []).map(publicProduct);
    const warnings = [
      ...(result?.warnings ?? []),
      ...(result?.filteredMismatchedCount
        ? [`已过滤 ${result.filteredMismatchedCount} 个详情类型不匹配的商品`]
        : []),
      ...(result?.filteredDemographicCount
        ? [`已过滤 ${result.filteredDemographicCount} 个性别或年龄不匹配的商品`]
        : []),
      ...(result?.missingDemographicCount
        ? [`有 ${result.missingDemographicCount} 个商品缺少性别属性，已按严格匹配规则排除`]
        : []),
      ...(result?.deduplicatedVariantCount
        ? [`已合并 ${result.deduplicatedVariantCount} 个重复商品变体`]
        : []),
      ...(!result ? ["采集器未返回该类目结果"] : []),
    ];
    const categoryName = target.categoryNameRu ?? target.title;
    return {
      target,
      category: key ? {
        name: categoryName,
        url: `https://www.ozon.ru/search/?text=${encodeURIComponent(categoryName)}`,
        path: target.categoryPathRu ?? [categoryName],
      } : null,
      ownProduct: own,
      competitors,
      benchmarks: competitors.length ? buildCompetitorBenchmarks(own, competitors) : null,
      warnings,
    };
  });
}

function crawlerScriptPath() {
  if (env.ozonCrawlerScript) return path.resolve(env.ozonCrawlerScript);
  const candidates = [
    path.resolve(process.cwd(), "tools/ozon-crawler/ozon_crawler.py"),
    path.resolve(process.cwd(), "../../tools/ozon-crawler/ozon_crawler.py"),
  ];
  return candidates.find(existsSync) ?? candidates[0]!;
}

export function ozonCrawlerConfigured() {
  return Boolean(env.ozonCrawlerCookieJar || env.ozonCrawlerCookieTsv);
}

export async function crawlOzonCompetitorsWithProcess(params: {
  requestId: string;
  targets: OzonCompetitorTarget[];
  ownSkus: Set<string>;
  limitPerCategory: number;
}) {
  if (!ozonCrawlerConfigured()) throw new Error("ozon_crawler_cookie_missing");
  const script = crawlerScriptPath();
  if (!existsSync(/* turbopackIgnore: true */ script)) throw new Error("ozon_crawler_script_missing");
  const job = buildOzonCrawlerJob({
    ...params,
    topN: params.limitPerCategory,
    scanPages: env.ozonCrawlerScanPages,
  });
  const tempDir = await mkdtemp(path.join(tmpdir(), "ozon-crawler-job-"));
  const jobPath = path.join(tempDir, "input.json");
  const outputPath = path.join(tempDir, "output.json");
  await writeFile(jobPath, JSON.stringify(job), "utf8");
  const cookieArgs = env.ozonCrawlerCookieTsv
    ? ["--tsv", env.ozonCrawlerCookieTsv]
    : ["--jar", env.ozonCrawlerCookieJar];
  const args = [script, "--job", jobPath, "--out", outputPath, ...cookieArgs];
  if (env.ozonCrawlerProxy) args.push("--proxy", env.ozonCrawlerProxy);
  try {
    const { stdout } = await execFileAsync(env.ozonCrawlerPython, args, {
      cwd: path.dirname(script),
      encoding: "utf8",
      timeout: env.ozonCrawlerTimeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, TEMP: tempDir, TMP: tempDir },
    });
    return parseOzonCrawlerOutput(JSON.parse(stdout), params.targets);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "unknown";
    throw new Error(`ozon_crawler_process_failed:${code}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
