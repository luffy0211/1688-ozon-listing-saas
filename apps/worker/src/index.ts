import { Worker } from "bullmq";
import { prisma, decryptSecret } from "@saas/db";
import {
  computeSalePriceRub,
  normalizeProduct,
  PIPELINE_STEPS,
  type NormalizedProductFact,
  type SourceProductImport,
} from "@saas/core";
import {
  checkSubmitGuards,
  compileOzonPayload,
  computeRequestHash,
  type OzonDraftInput,
} from "@saas/ozon";
import { XiangjiClient } from "@saas/xiangji";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asSourceProduct(value: unknown): SourceProductImport | null {
  const data = asRecord(value);
  if (data.source === "1688" && typeof data.offerId === "string") {
    return data as unknown as SourceProductImport;
  }
  return null;
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNormalized(raw: unknown, fallbackTitle?: string | null): NormalizedProductFact {
  const source = asSourceProduct(raw);
  if (source && Array.isArray(source.priceTiers)) return normalizeProduct(source);
  return {
    title: fallbackTitle ?? "unknown",
    categoryPath: [],
    brand: { value: "无品牌", estimated: false, confidence: 1 },
    properties: [],
    priceTiers: [],
    skus: [],
    purchaseCny: { value: 0, estimated: true, confidence: 0 },
    mainImages: [],
    detailImages: [],
  };
}

async function markStep(
  jobId: string,
  stepName: string,
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED",
  data: { inputJson?: unknown; outputJson?: unknown; error?: string } = {},
) {
  await prisma.jobStep.updateMany({
    where: { jobId, stepName },
    data: {
      status,
      inputJson: data.inputJson as never,
      outputJson: data.outputJson as never,
      error: data.error,
      startedAt: status === "RUNNING" ? new Date() : undefined,
      finishedAt: status === "SUCCEEDED" || status === "FAILED" || status === "SKIPPED" ? new Date() : undefined,
    },
  });
}

async function runStep<T>(
  jobId: string,
  stepName: string,
  fn: () => Promise<T>,
): Promise<T> {
  await markStep(jobId, stepName, "RUNNING");
  try {
    const result = await fn();
    await markStep(jobId, stepName, "SUCCEEDED", { outputJson: result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markStep(jobId, stepName, "FAILED", { error: message });
    throw error;
  }
}

async function processListing(jobId: string) {
  await prisma.listingJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  });

  const job = await prisma.listingJob.findUnique({
    where: { id: jobId },
    include: {
      product: {
        include: {
          productFacts: { orderBy: { createdAt: "desc" }, take: 1 },
          productAssets: true,
        },
      },
      store: true,
    },
  });
  if (!job) throw new Error(`listing job not found: ${jobId}`);

  let fact = getNormalized(job.product.rawJson, job.product.title);
  let titleRu = `${fact.title} / RU`;
  let descriptionRu = firstString(fact.descriptionText) ?? fact.title;
  let bulletPointsRu: string[] = [];
  const detailImages = job.product.productAssets
    .filter((asset) => asset.kind === "detail_image")
    .map((asset) => asset.publicUrl ?? asset.sourceUrl)
    .filter((url): url is string => Boolean(url));
  const mainImages = job.product.productAssets
    .filter((asset) => asset.kind === "main_image" || asset.kind === "sku_image")
    .map((asset) => asset.publicUrl ?? asset.sourceUrl)
    .filter((url): url is string => Boolean(url));

  try {
    await runStep(jobId, "validate_import", async () => {
      if (!job.product.offerId) throw new Error("缺少 1688 offerId");
      return { offerId: job.product.offerId };
    });

    await runStep(jobId, "download_assets", async () => ({
      mainImages: mainImages.length,
      detailImages: detailImages.length,
    }));

    await runStep(jobId, "normalize_product_facts", async () => {
      const existing = job.product.productFacts[0];
      if (existing?.normalizedJson) {
        fact = existing.normalizedJson as unknown as NormalizedProductFact;
      } else {
        await prisma.productFact.create({
          data: {
            tenantId: job.tenantId,
            productId: job.productId,
            normalizedJson: fact as never,
          },
        });
      }
      return fact;
    });

    const xiangjiCredential = await prisma.xiangjiCredential.findFirst({
      where: { tenantId: job.tenantId },
      orderBy: { createdAt: "desc" },
    });

    await runStep(jobId, "translate_product_info", async () => {
      if (!xiangjiCredential) throw new Error("缺少象寄 X-API-Key");
      const client = new XiangjiClient({
        apiKey: decryptSecret(xiangjiCredential.apiKey),
        mock: process.env.XIANGJI_MOCK !== "false",
      });
      const bulletPointSource = fact.properties
        .slice(0, 5)
        .map((p) => `${p.name}: ${p.value}`);
      const descriptionSource = descriptionRu;
      const [translatedTitle, translatedDesc, ...translatedBullets] = await client.translateText(
        [fact.title, descriptionSource, ...bulletPointSource],
        { vendor: job.store.translationVendor },
      );
      titleRu = translatedTitle ?? titleRu;
      descriptionRu = translatedDesc ?? descriptionRu;
      bulletPointsRu = translatedBullets.length > 0 ? translatedBullets : bulletPointSource;
      await prisma.translationTask.create({
        data: {
          tenantId: job.tenantId,
          productId: job.productId,
          vendor: job.store.translationVendor,
          status: "done",
          inputJson: { title: fact.title, description: descriptionSource, bulletPoints: bulletPointSource } as never,
          outputJson: { titleRu, descriptionRu, bulletPointsRu } as never,
        },
      });
      return { titleRu, descriptionRu, bulletPointsRu };
    });

    const categoryId = await runStep(jobId, "match_ozon_category", async () => ({
      ozonCategoryId: "unknown",
      strategy: "v1_manual_fallback",
    }));

    const content = await runStep(jobId, "generate_ozon_content", async () => ({
      titleRu,
      bulletPointsRu,
      descriptionRu,
      searchKeywordsRu: fact.categoryPath.join(", "),
      ozonCategoryId: categoryId.ozonCategoryId,
      ozonAttributes: [],
    }));

    const priceRub = await runStep(jobId, "generate_pricing", async () => {
      const rule =
        (await prisma.pricingRule.findFirst({
          where: { tenantId: job.tenantId, storeId: job.storeId },
        })) ??
        (await prisma.pricingRule.findFirst({
          where: { tenantId: job.tenantId, isDefault: true },
        }));
      const price = computeSalePriceRub({
        purchaseCny: fact.purchaseCny.value,
        domesticShippingCny: Number(rule?.domesticShippingCny ?? 0),
        packagingCny: Number(rule?.packagingCny ?? 0),
        cnyToRub: Number(rule?.cnyToRub ?? 12),
        internationalShippingRub: Number(rule?.internationalShippingRub ?? 0),
        commissionRate: Number(rule?.commissionRate ?? 0.15),
        targetMarginRate: Number(rule?.targetMarginRate ?? 0.2),
      });
      return { priceRub: price };
    });

    const draftInput: OzonDraftInput = {
      offerId: job.product.offerId,
      titleRu: content.titleRu,
      bulletPointsRu: content.bulletPointsRu,
      descriptionRu: content.descriptionRu,
      searchKeywordsRu: content.searchKeywordsRu,
      categoryId: 0,
      attributes: [],
      priceRub: priceRub.priceRub,
      mainImages,
      detailImages,
      weightGrams: 0,
      dimensions: { widthMm: 0, heightMm: 0, depthMm: 0 },
    };
    const payload = compileOzonPayload(draftInput);

    await runStep(jobId, "qc_check", async () => {
      const requestHash = computeRequestHash(job.storeId, { items: [payload] });
      const duplicate = await prisma.publishRun.findUnique({
        where: { storeId_requestHash: { storeId: job.storeId, requestHash } },
      });
      const guard = checkSubmitGuards({
        hasOzonCredentials: Boolean(job.store.ozonClientId && job.store.ozonApiKey),
        hasXiangjiKey: Boolean(xiangjiCredential),
        hasMainImage: mainImages.length > 0,
        hasDetailImage: detailImages.length > 0,
        hasPrice: priceRub.priceRub > 0,
        payload,
        duplicateSubmission: Boolean(duplicate),
      });
      if (!guard.ok) throw new Error(guard.failures.join("; "));
      return guard;
    });

    await runStep(jobId, "compile_ozon_payload", async () => {
      const draft = await prisma.ozonDraft.create({
        data: {
          tenantId: job.tenantId,
          productId: job.productId,
          storeId: job.storeId,
          jobId,
          status: "COMPILED",
          titleRu: draftInput.titleRu,
          priceRub: draftInput.priceRub,
          ozonCategoryId: String(draftInput.categoryId),
          payloadJson: { items: [payload] } as never,
        },
      });
      await prisma.sourceProduct.update({
        where: { id: job.productId },
        data: { status: "draft_ready" },
      });
      return draft;
    });

    await prisma.listingJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED", finishedAt: new Date(), currentStep: PIPELINE_STEPS.length },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.listingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: message, finishedAt: new Date() },
    });
    throw error;
  }
}

const worker = new Worker(
  "listing",
  async (job) => {
    const jobId = job.data?.jobId;
    if (typeof jobId !== "string") throw new Error("BullMQ job missing jobId");
    await processListing(jobId);
  },
  {
    connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  },
);

worker.on("completed", (job) => {
  console.log(`listing job completed: ${job.id}`);
});

worker.on("failed", (job, error) => {
  console.error(`listing job failed: ${job?.id}`, error);
});

console.log("listing worker started");
