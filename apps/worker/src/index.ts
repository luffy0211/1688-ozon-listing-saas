import { Worker } from "bullmq";
import { CreditTransactionType, Prisma, prisma, decryptSecret } from "@saas/db";
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
  mockImportProducts,
  OzonClient,
  type OzonDraftInput,
} from "@saas/ozon";
import { XiangjiClient } from "@saas/xiangji";
import {
  asRecord,
  buildRequiredOzonAttributes,
  firstString,
  matchOzonCategory,
  ozonDraftFacts,
  packageDefaults,
  type OzonDraftFacts,
} from "./ozon-draft-facts";
import { generateRussianListingContent } from "./listing-content";
import type { RussianClothingAttributes } from "./listing-content";
import { translateWithOpenAiCompatible } from "./translate-text";
import { matchOzonCategoryWithModel } from "./ozon-category-match";

type JsonRecord = Record<string, unknown>;
type ProductAssetLike = {
  kind: string;
  publicUrl?: string | null;
  sourceUrl?: string | null;
};

const LISTING_PUBLISH_CREDIT_COST = 30;

async function findCreditTransaction(idempotencyKey: string) {
  return prisma.creditTransaction.findUnique({ where: { idempotencyKey } });
}

async function writeListingPublishCreditTransaction(params: {
  tenantId: string;
  delta: number;
  type: CreditTransactionType;
  reason: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
}) {
  const existing = await findCreditTransaction(params.idempotencyKey);
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.idempotencyKey}))`;
      const replay = await tx.creditTransaction.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (replay) return replay;

      const account = await tx.creditAccount.upsert({
        where: { tenantId: params.tenantId },
        create: { tenantId: params.tenantId, balance: 0 },
        update: {},
      });
      const updatedAccount = params.delta > 0
        ? await tx.creditAccount.update({
            where: { id: account.id },
            data: { balance: { increment: LISTING_PUBLISH_CREDIT_COST } },
          })
        : await (async () => {
            const result = await tx.creditAccount.updateMany({
              where: { id: account.id, balance: { gte: LISTING_PUBLISH_CREDIT_COST } },
              data: { balance: { decrement: LISTING_PUBLISH_CREDIT_COST } },
            });
            if (result.count !== 1) throw new Error("insufficient_credits");
            const updated = await tx.creditAccount.findUnique({ where: { id: account.id } });
            if (!updated) throw new Error("credit_account_not_found");
            return updated;
          })();

      return tx.creditTransaction.create({
        data: {
          tenantId: params.tenantId,
          accountId: account.id,
          type: params.type,
          delta: params.delta,
          balanceAfter: updatedAccount.balance,
          reason: params.reason,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          idempotencyKey: params.idempotencyKey,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await findCreditTransaction(params.idempotencyKey);
      if (replay) return replay;
    }
    throw error;
  }
}

async function consumeListingPublishCredits(params: {
  tenantId: string;
  draftId: string;
  storeId: string;
  requestHash: string;
}) {
  return writeListingPublishCreditTransaction({
    tenantId: params.tenantId,
    delta: -LISTING_PUBLISH_CREDIT_COST,
    type: CreditTransactionType.USAGE_DEBIT,
    reason: "商品上架",
    referenceType: "ozon_draft_publish",
    referenceId: params.draftId,
    idempotencyKey: `listing-publish:${params.storeId}:${params.requestHash}`,
  });
}

async function refundListingPublishCredits(params: {
  tenantId: string;
  draftId: string;
  storeId: string;
  requestHash: string;
}) {
  return writeListingPublishCreditTransaction({
    tenantId: params.tenantId,
    delta: LISTING_PUBLISH_CREDIT_COST,
    type: CreditTransactionType.USAGE_REFUND,
    reason: "商品上架失败退回",
    referenceType: "ozon_draft_publish",
    referenceId: params.draftId,
    idempotencyKey: `refund:listing-publish:${params.storeId}:${params.requestHash}`,
  });
}

function asSourceProduct(value: unknown): SourceProductImport | null {
  const data = asRecord(value);
  if (data.source === "1688" && typeof data.offerId === "string") {
    return data as unknown as SourceProductImport;
  }
  return null;
}

function assertNoChineseBuyerText(values: Record<string, unknown>) {
  const cjk = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  const badFields: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string" && cjk.test(value)) badFields.push(path);
    else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key));
    }
  };
  Object.entries(values).forEach(([key, value]) => visit(value, key));
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

function ozonCurrencyCode(): string {
  return (process.env.OZON_PRICE_CURRENCY_CODE ?? "RUB").trim().toUpperCase() || "RUB";
}

function priceForCurrency(priceRub: number, cnyToRub: number, currencyCode: string): number {
  if (currencyCode !== "CNY") return priceRub;
  return Math.ceil(priceRub / Math.max(cnyToRub, 1) / 10) * 10;
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
  descriptionRu?: string;
  bulletPointsRu?: string[];
  searchKeywordsRu?: string;
  attributesRu?: RussianClothingAttributes;
  detailImages?: string[];
  store: { ozonClientId: string | null; ozonApiKey: string | null };
}): Promise<OzonDraftFacts> {
  let facts = params.facts;
  let client: OzonClient | null = null;
  const getClient = () => {
    client ??= ozonReadClient(params.store);
    return client;
  };

  if (!facts.descriptionCategoryId || !facts.typeId) {
    const tree = await getClient().getCategoryTree();
    let matched = null;
    try {
      matched = await matchOzonCategoryWithModel(tree, {
        titleZh: params.fact.title,
        titleRu: params.titleRu,
        categoryPath: params.fact.categoryPath,
        properties: params.fact.properties.map(({ name, value }) => ({ name, value })),
      });
    } catch (error) {
      console.warn(
        `DeepSeek Ozon 类目匹配失败，使用本地规则兜底: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    matched ??= matchOzonCategory(tree, params.fact);
    if (!matched) {
      throw new Error("无法从 1688 商品信息自动匹配 Ozon 类目，请检查 DeepSeek 配置或商品信息");
    }
    facts = {
      ...facts,
      descriptionCategoryId: facts.descriptionCategoryId ?? matched.descriptionCategoryId,
      typeId: facts.typeId ?? matched.typeId,
    };
  }

  if (!facts.descriptionCategoryId || !facts.typeId) return facts;

  {
    const ozonClient = getClient();
    const categoryAttributes = await ozonClient.getCategoryAttributes(
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
        (attributeId) => ozonClient.getAttributeValues(facts.descriptionCategoryId!, facts.typeId!, attributeId),
        {
          descriptionRu: params.descriptionRu,
          bulletPointsRu: params.bulletPointsRu,
          searchKeywordsRu: params.searchKeywordsRu,
          attributesRu: params.attributesRu,
          detailImages: params.detailImages,
        },
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

async function submitDraft(params: {
  tenantId: string;
  productId: string;
  draftId: string;
  storeId: string;
  store: { ozonClientId: string | null; ozonApiKey: string | null };
  request: JsonRecord;
}) {
  if (!Array.isArray(params.request.items) || params.request.items.length === 0) {
    throw new Error("草稿 payload 为空，无法提交");
  }
  if (!params.store.ozonClientId || !params.store.ozonApiKey) {
    throw new Error("请先配置 Ozon 店铺密钥");
  }

  const requestHash = computeRequestHash(params.storeId, params.request);
  const duplicate = await prisma.publishRun.findUnique({
    where: { storeId_requestHash: { storeId: params.storeId, requestHash } },
  });
  if (duplicate) {
    throw new Error("同一店铺同一草稿已提交过，禁止重复上架");
  }

  await consumeListingPublishCredits({
    tenantId: params.tenantId,
    draftId: params.draftId,
    storeId: params.storeId,
    requestHash,
  });

  try {
    const response =
      process.env.ENABLE_REAL_OZON_SUBMIT === "true"
        ? await new OzonClient({
            clientId: params.store.ozonClientId,
            apiKey: decryptSecret(params.store.ozonApiKey),
          }).importProducts(params.request as never)
        : mockImportProducts(params.request as never);
    const run = await prisma.publishRun.create({
      data: {
        tenantId: params.tenantId,
        draftId: params.draftId,
        storeId: params.storeId,
        requestHash,
        ozonTaskId: String(response.task_id),
        status: "submitted",
        requestJson: params.request as never,
        responseJson: response as never,
      },
    });
    await prisma.ozonDraft.update({
      where: { id: params.draftId },
      data: { status: "SUBMITTED" },
    });
    await prisma.sourceProduct.update({
      where: { id: params.productId },
      data: { status: "submitted" },
    });
    return { publishRunId: run.id, ozonTaskId: run.ozonTaskId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await refundListingPublishCredits({
      tenantId: params.tenantId,
      draftId: params.draftId,
      storeId: params.storeId,
      requestHash,
    }).catch(() => null);
    await prisma.publishRun.create({
      data: {
        tenantId: params.tenantId,
        draftId: params.draftId,
        storeId: params.storeId,
        requestHash,
        status: "failed",
        requestJson: params.request as never,
        error: message,
      },
    });
    await prisma.ozonDraft.update({
      where: { id: params.draftId },
      data: { status: "FAILED", error: message },
    });
    throw error;
  }
}

async function processListing(jobId: string, options: { autoPublish?: boolean } = {}) {
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
  let searchKeywordsRu = "";
  let attributesRu: RussianClothingAttributes = {};
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
      const bulletPointSource = fact.properties
        .slice(0, 5)
        .map((p) => `${p.name}: ${p.value}`);
      const descriptionSource = descriptionRu;
      let vendor = "deepseek";
      try {
        const content = await generateRussianListingContent(fact);
        titleRu = content.titleRu;
        descriptionRu = content.descriptionRu;
        bulletPointsRu = content.bulletPointsRu;
        searchKeywordsRu = content.hashtagsRu;
        attributesRu = content.attributesRu;
      } catch (error) {
        console.warn(
          `DeepSeek 商品文案失败，改用象寄文本翻译兜底: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!xiangjiCredential) throw new Error("缺少象寄 X-API-Key");
        const client = new XiangjiClient({
          apiKey: decryptSecret(xiangjiCredential.apiKey),
          mock: process.env.XIANGJI_MOCK !== "false",
        });
        const [translatedTitle, translatedDesc, ...translatedBullets] = await translateProductText({
          client,
          texts: [fact.title, descriptionSource, ...bulletPointSource],
          vendor: job.store.translationVendor,
        });
        vendor = job.store.translationVendor;
        titleRu = translatedTitle ?? titleRu;
        descriptionRu = translatedDesc ?? descriptionRu;
        bulletPointsRu = translatedBullets.length > 0 ? translatedBullets : bulletPointSource;
        searchKeywordsRu = "";
        attributesRu = {};
      }
      assertNoChineseBuyerText({ titleRu, descriptionRu, bulletPointsRu, searchKeywordsRu, attributesRu });
      await prisma.translationTask.create({
        data: {
          tenantId: job.tenantId,
          productId: job.productId,
          vendor,
          status: "done",
          inputJson: { title: fact.title, description: descriptionSource, bulletPoints: bulletPointSource } as never,
          outputJson: { titleRu, descriptionRu, bulletPointsRu, searchKeywordsRu, attributesRu } as never,
        },
      });
      return { titleRu, descriptionRu, bulletPointsRu, searchKeywordsRu, attributesRu, vendor };
    });

    const category = await runStep(jobId, "match_ozon_category", async () => {
      ozonFacts = await completeOzonFacts({
        facts: ozonFacts,
        fact,
        titleRu,
        descriptionRu,
        bulletPointsRu,
        searchKeywordsRu,
        attributesRu,
        detailImages,
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
        strategy: "source_json_or_deepseek",
      };
    });

    const content = await runStep(jobId, "generate_ozon_content", async () => ({
      titleRu,
      bulletPointsRu,
      descriptionRu,
      searchKeywordsRu,
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
      const currencyCode = ozonCurrencyCode();
      return {
        priceRub: priceForCurrency(price, Number(rule?.cnyToRub ?? 12), currencyCode),
        currencyCode,
      };
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
      currencyCode: priceRub.currencyCode,
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

    const draft = await runStep(jobId, "compile_ozon_payload", async () => {
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

    if (options.autoPublish) {
      await runStep(jobId, "submit_ozon", async () =>
        submitDraft({
          tenantId: job.tenantId,
          productId: job.productId,
          draftId: draft.id,
          storeId: job.storeId,
          store: job.store,
          request: { items: [payload] },
        }),
      );
    } else {
      await markStep(jobId, "submit_ozon", "SKIPPED", {
        outputJson: { reason: "autoPublish disabled" },
      });
    }

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
    await prisma.sourceProduct.update({
      where: { id: job.productId },
      data: { status: "failed" },
    });
    throw error;
  }
}

const worker = new Worker(
  "listing",
  async (job) => {
    const jobId = job.data?.jobId;
    if (typeof jobId !== "string") throw new Error("BullMQ job missing jobId");
    await processListing(jobId, { autoPublish: job.data?.autoPublish === true });
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
