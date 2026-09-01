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
  OzonClient,
  type OzonDraftInput,
} from "@saas/ozon";
import { XiangjiClient } from "@saas/xiangji";
import {
  asRecord,
  buildRequiredOzonAttributes,
  firstNumber,
  firstString,
  matchOzonCategory,
  ozonDraftFacts,
  packageDefaults,
  type OzonDraftFacts,
} from "./ozon-draft-facts";
import { translateWithOpenAiCompatible } from "./translate-text";

type JsonRecord = Record<string, unknown>;
type ProductAssetLike = {
  kind: string;
  publicUrl?: string | null;
  sourceUrl?: string | null;
};

function asSourceProduct(value: unknown): SourceProductImport | null {
  const data = asRecord(value);
  if (data.source === "1688" && typeof data.offerId === "string") {
    return data as unknown as SourceProductImport;
  }
  return null;
}

function assertNoChineseBuyerText(values: Record<string, unknown>) {
  const cjk = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  const badFields = Object.entries(values).flatMap(([key, value]) => {
    const items = Array.isArray(value) ? value : [value];
    return items.some((item) => typeof item === "string" && cjk.test(item)) ? [key] : [];
  });
  if (badFields.length > 0) {
    throw new Error(`俄语文案仍含中文: ${badFields.join(", ")}`);
  }
}

async function translateProductText(params: {
  client: XiangjiClient;
  texts: string[];
  vendor?: string;
}): Promise<string[]> {
  try {
    return await params.client.translateText(params.texts, { vendor: params.vendor });
  } catch (error) {
    console.warn(
      `象寄文本翻译失败，改用模型翻译兜底: ${error instanceof Error ? error.message : String(error)}`,
    );
    return translateWithOpenAiCompatible(params.texts);
  }
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

function ozonReadClient(store: {
  ozonClientId: string | null;
  ozonApiKey: string | null;
}): OzonClient {
  if (!store.ozonClientId || !store.ozonApiKey) {
    throw new Error("缺少 Ozon 店铺密钥，无法自动匹配类目");
  }
  return new OzonClient({
    clientId: store.ozonClientId,
    apiKey: decryptSecret(store.ozonApiKey),
    enableRealSubmit: false,
  });
}

async function completeOzonFacts(params: {
  facts: OzonDraftFacts;
  fact: NormalizedProductFact;
  titleRu: string;
  store: { ozonClientId: string | null; ozonApiKey: string | null };
}): Promise<OzonDraftFacts> {
  let facts = params.facts;
  const client = !facts.descriptionCategoryId || !facts.typeId || facts.attributes.length === 0
    ? ozonReadClient(params.store)
    : null;

  if ((!facts.descriptionCategoryId || !facts.typeId) && client) {
    const matched = matchOzonCategory(await client.getCategoryTree(), params.fact);
    if (!matched) {
      throw new Error("无法从 1688 商品信息自动匹配 Ozon 类目，请在 rawJson.ozon 中补 description_category_id 和 type_id");
    }
    facts = {
      ...facts,
      descriptionCategoryId: facts.descriptionCategoryId ?? matched.descriptionCategoryId,
      typeId: facts.typeId ?? matched.typeId,
    };
  }

  if (!facts.descriptionCategoryId || !facts.typeId) return facts;

  if (facts.attributes.length === 0 && client) {
    const categoryAttributes = await client.getCategoryAttributes(
      facts.descriptionCategoryId,
      facts.typeId,
    );
    facts = {
      ...facts,
      attributes: await buildRequiredOzonAttributes(
        params.fact,
        params.titleRu,
        categoryAttributes,
        facts.attributes,
        (attributeId) => client.getAttributeValues(facts.descriptionCategoryId!, facts.typeId!, attributeId),
      ),
    };
  }

  const defaults = packageDefaults(params.fact);
  return {
    ...facts,
    weightGrams: facts.weightGrams ?? defaults.weightGrams,
    dimensions: {
      widthMm: facts.dimensions.widthMm ?? defaults.dimensions.widthMm,
      heightMm: facts.dimensions.heightMm ?? defaults.dimensions.heightMm,
      depthMm: facts.dimensions.depthMm ?? defaults.dimensions.depthMm,
    },
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
  let ozonFacts = ozonDraftFacts(job.product.rawJson);
  let titleRu = `${fact.title} / RU`;
  let descriptionRu = firstString(fact.descriptionText) ?? fact.title;
  let bulletPointsRu: string[] = [];
  const detailImages = job.product.productAssets
    .filter((asset: ProductAssetLike) => asset.kind === "detail_image")
    .map((asset: ProductAssetLike) => asset.publicUrl ?? asset.sourceUrl)
    .filter((url: string | null | undefined): url is string => Boolean(url));
  const mainImages = job.product.productAssets
    .filter((asset: ProductAssetLike) => asset.kind === "main_image" || asset.kind === "sku_image")
    .map((asset: ProductAssetLike) => asset.publicUrl ?? asset.sourceUrl)
    .filter((url: string | null | undefined): url is string => Boolean(url));

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
      const [translatedTitle, translatedDesc, ...translatedBullets] = await translateProductText({
        client,
        texts: [fact.title, descriptionSource, ...bulletPointSource],
        vendor: job.store.translationVendor,
      });
      titleRu = translatedTitle ?? titleRu;
      descriptionRu = translatedDesc ?? descriptionRu;
      bulletPointsRu = translatedBullets.length > 0 ? translatedBullets : bulletPointSource;
      assertNoChineseBuyerText({ titleRu, descriptionRu, bulletPointsRu });
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

    const category = await runStep(jobId, "match_ozon_category", async () => {
      ozonFacts = await completeOzonFacts({
        facts: ozonFacts,
        fact,
        titleRu,
        store: job.store,
      });
      if (!ozonFacts.descriptionCategoryId) {
        throw new Error("缺少 Ozon description_category_id，请先由采集脚本或人工匹配类目");
      }
      if (!ozonFacts.typeId) {
        throw new Error("缺少 Ozon type_id，请先由采集脚本或人工匹配商品类型");
      }
      return {
        descriptionCategoryId: ozonFacts.descriptionCategoryId,
        typeId: ozonFacts.typeId,
        strategy: "source_json_or_manual",
      };
    });

    const content = await runStep(jobId, "generate_ozon_content", async () => ({
      titleRu,
      bulletPointsRu,
      descriptionRu,
      searchKeywordsRu: fact.categoryPath.join(", "),
      descriptionCategoryId: category.descriptionCategoryId,
      typeId: category.typeId,
      ozonAttributes: ozonFacts.attributes,
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
      descriptionCategoryId: content.descriptionCategoryId,
      typeId: content.typeId,
      attributes: content.ozonAttributes,
      priceRub: priceRub.priceRub,
      mainImages,
      detailImages,
      weightGrams: ozonFacts.weightGrams ?? 0,
      dimensions: {
        widthMm: ozonFacts.dimensions.widthMm ?? 0,
        heightMm: ozonFacts.dimensions.heightMm ?? 0,
        depthMm: ozonFacts.dimensions.depthMm ?? 0,
      },
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
          ozonCategoryId: String(draftInput.descriptionCategoryId),
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
