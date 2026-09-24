import { readFile, writeFile } from "node:fs/promises";
import { Prisma, prisma } from "@saas/db";
import {
  buildCompetitorBenchmarks,
  inferOzonCategoryName,
  inferOzonGender,
  type OzonCompetitorTarget,
  type OzonPublicProduct,
} from "../../apps/web/src/lib/agent/ozon-public-crawler";

const DETAIL_SCOPE = "category_search_index_attributes_description_v3";
const DEFAULT_TOP_N = 5;
const DEFAULT_SCAN_PAGES = 20;

type JsonRecord = Record<string, unknown>;

type CrawlerCompetitor = {
  publicRank?: number;
  sku: string;
  url: string;
  title: string;
  description?: string | null;
  priceRub?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  sellerName?: string | null;
  imageUrls?: string[];
  attributes?: Record<string, string>;
};

type CrawlerCategory = {
  categoryKey: string;
  competitors?: CrawlerCompetitor[];
  warnings?: string[];
};

type CrawlerOutput = {
  requestId?: string;
  capturedAt?: string;
  categories?: CrawlerCategory[];
};

function arg(name: string, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function intArg(name: string, fallback: number) {
  const parsed = Number(arg(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function resolveStore() {
  const id = arg("store-id");
  const tenantId = arg("tenant-id");
  const store = await prisma.store.findFirst({
    where: { ...(id ? { id } : {}), ...(tenantId ? { tenantId } : {}) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (!store) throw new Error("store_not_found");
  return store;
}

async function categoryTargets(): Promise<{ storeId: string; tenantId: string; targets: OzonCompetitorTarget[] }> {
  const store = await resolveStore();
  const snapshots = await prisma.ozonProductSnapshot.findMany({
    where: { tenantId: store.tenantId, storeId: store.id, archived: false, name: { not: null } },
    orderBy: [{ stock: "desc" }, { updatedAt: "desc" }],
  });
  const byCategory = new Map<string, OzonCompetitorTarget>();
  for (const snapshot of snapshots) {
    const raw = record(snapshot.rawJson);
    const descriptionCategoryId = num(raw.descriptionCategoryId);
    const typeId = num(raw.typeId);
    if (!descriptionCategoryId || !typeId || byCategory.has(`${descriptionCategoryId}:${typeId}`)) continue;
    const target: OzonCompetitorTarget = {
      offerId: snapshot.offerId,
      title: snapshot.name ?? snapshot.offerId,
      publicSku: str(raw.publicSku),
      quantity: 0,
      revenueRub: 0,
      descriptionCategoryId,
      typeId,
      categoryNameRu: null,
      categoryPathRu: [],
    };
    byCategory.set(`${descriptionCategoryId}:${typeId}`, {
      ...target,
      categoryNameRu: inferOzonCategoryName(target),
      gender: inferOzonGender(target),
      ageGroup: inferOzonGender(target) === "Детский" ? "Дети" : "Взрослые",
    });
  }
  return { storeId: store.id, tenantId: store.tenantId, targets: [...byCategory.values()] };
}

async function exportJob() {
  const { storeId, targets } = await categoryTargets();
  const topN = intArg("top-n", DEFAULT_TOP_N);
  const scanPages = intArg("scan-pages", DEFAULT_SCAN_PAGES);
  const job = {
    requestId: `local-cache-${Date.now()}`,
    storeId,
    topN,
    scanPages,
    categories: targets.map((target) => ({
      categoryKey: `${target.descriptionCategoryId}:${target.typeId}`,
      descriptionCategoryId: target.descriptionCategoryId,
      typeId: target.typeId,
      categoryNameRu: target.categoryNameRu ?? target.title,
      productType: target.categoryNameRu ?? target.title,
      gender: target.gender,
      ageGroup: target.ageGroup,
      referenceOfferId: target.offerId,
    })),
    excludeSkus: targets.flatMap((target) => target.publicSku ? [target.publicSku] : []),
  };
  const out = arg("out", "ozon-competitor-job.json");
  await writeFile(out, JSON.stringify(job, null, 2), "utf8");
  console.log(`exported ${job.categories.length} categories to ${out}`);
}

function competitorProduct(value: CrawlerCompetitor): OzonPublicProduct {
  return {
    sku: value.sku,
    url: value.url,
    title: value.title,
    priceRub: value.priceRub ?? null,
    oldPriceRub: null,
    rating: value.rating ?? null,
    reviewCount: value.reviewCount ?? null,
    sellerName: value.sellerName ?? null,
    imageUrls: value.imageUrls ?? [],
    attributes: value.attributes ?? {},
    description: value.description ?? null,
    reviews: [],
    categoryPosition: value.publicRank ?? undefined,
  };
}

async function importOutput() {
  const input = arg("input");
  if (!input) throw new Error("missing --input");
  const store = await resolveStore();
  const { targets } = await categoryTargets();
  const targetByKey = new Map(targets.map((target) => [`${target.descriptionCategoryId}:${target.typeId}`, target]));
  const output = JSON.parse(await readFile(input, "utf8")) as CrawlerOutput;
  const capturedAt = new Date(output.capturedAt ?? Date.now());
  let categoryCount = 0;
  let competitorCount = 0;

  for (const category of output.categories ?? []) {
    const target = targetByKey.get(category.categoryKey);
    if (!target) continue;
    const competitors = (category.competitors ?? []).map(competitorProduct);
    if (!competitors.length) continue;
    const competitorIds: string[] = [];
    for (const competitor of competitors) {
      const saved = await prisma.competitorProduct.upsert({
        where: { tenantId_url: { tenantId: store.tenantId, url: competitor.url } },
        update: {
          sku: competitor.sku,
          title: competitor.title,
          sellerName: competitor.sellerName,
          priceText: competitor.priceRub === null ? null : String(competitor.priceRub),
          rating: competitor.rating === null ? null : new Prisma.Decimal(competitor.rating),
          reviewCount: competitor.reviewCount,
          imageUrlsJson: competitor.imageUrls as never,
          attributesJson: competitor.attributes as never,
          description: competitor.description,
          rawJson: { source: "local_ozon_crawler", categoryKey: category.categoryKey } as never,
          lastCapturedAt: capturedAt,
        },
        create: {
          tenantId: store.tenantId,
          url: competitor.url,
          sku: competitor.sku,
          title: competitor.title,
          sellerName: competitor.sellerName,
          priceText: competitor.priceRub === null ? null : String(competitor.priceRub),
          rating: competitor.rating === null ? null : new Prisma.Decimal(competitor.rating),
          reviewCount: competitor.reviewCount,
          imageUrlsJson: competitor.imageUrls as never,
          attributesJson: competitor.attributes as never,
          description: competitor.description,
          rawJson: { source: "local_ozon_crawler", categoryKey: category.categoryKey } as never,
          lastCapturedAt: capturedAt,
        },
      });
      competitorIds.push(saved.id);
      await prisma.competitorProductSnapshot.create({
        data: {
          tenantId: store.tenantId,
          productId: saved.id,
          title: competitor.title,
          priceText: competitor.priceRub === null ? null : String(competitor.priceRub),
          rating: competitor.rating === null ? null : new Prisma.Decimal(competitor.rating),
          reviewCount: competitor.reviewCount,
          imageUrlsJson: competitor.imageUrls as never,
          attributesJson: competitor.attributes as never,
          description: competitor.description,
          rawJson: competitor as never,
          capturedAt,
        },
      });
    }
    const ownProduct: OzonPublicProduct = {
      sku: target.publicSku ?? target.offerId,
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
    await prisma.competitorContentReport.create({
      data: {
        tenantId: store.tenantId,
        competitorProductId: competitorIds[0],
        ozonOfferId: target.offerId,
        title: `竞品分析：${target.title}`,
        createdBy: "local-ozon-cache-import",
        reportJson: {
          source: "ozon_http_crawler",
          detailScope: DETAIL_SCOPE,
          competitorsPerCategory: intArg("top-n", DEFAULT_TOP_N),
          storeId: store.id,
          target,
          category: {
            name: target.categoryNameRu ?? target.title,
            url: `https://www.ozon.ru/search/?text=${encodeURIComponent(target.categoryNameRu ?? target.title)}`,
            path: target.categoryNameRu ? [target.categoryNameRu] : [],
          },
          ownProduct,
          competitorProductIds: competitorIds,
          competitors,
          benchmarks: buildCompetitorBenchmarks(ownProduct, competitors),
          capturedAt: capturedAt.toISOString(),
          importedFrom: input,
        } as never,
      },
    });
    categoryCount += 1;
    competitorCount += competitors.length;
  }
  console.log(`imported ${competitorCount} competitors across ${categoryCount} categories`);
}

async function main() {
  if (hasFlag("help") || !process.argv[2]) {
    console.log("usage: tsx tools/ozon-crawler/competitor_cache.ts export-job --out job.json [--top-n 5] [--scan-pages 20]");
    console.log("   or: tsx tools/ozon-crawler/competitor_cache.ts import --input output.json [--store-id id]");
    return;
  }
  if (process.argv[2] === "export-job") return exportJob();
  if (process.argv[2] === "import") return importOutput();
  throw new Error(`unknown command: ${process.argv[2]}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
