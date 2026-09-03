import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { displayProductImageUrl, preferredProductImageUrl } from "@/lib/product-image";
import { WorkflowWizard } from "@/components/workflow-wizard";
import { PageHeader } from "@/components/ui";

function productImageUrls(assets: Array<{ publicUrl: string | null; sourceUrl: string | null }>) {
  return assets
    .map((asset) => asset.publicUrl ?? asset.sourceUrl)
    .filter((url): url is string => Boolean(url))
    .map(displayProductImageUrl);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function productAttributes(product: { rawJson: unknown; productFacts: Array<{ normalizedJson: unknown }> }) {
  const fact = asRecord(product.productFacts[0]?.normalizedJson);
  const raw = asRecord(product.rawJson);
  const rows: Array<{ name: string; value: string }> = [];
  const add = (name: string, value: unknown) => {
    const v = text(value);
    if (v && !rows.some((row) => row.name === name && row.value === v)) rows.push({ name, value: v });
  };

  const categoryPath = Array.isArray(fact.categoryPath) ? fact.categoryPath.map(text).filter(Boolean).join(" / ") : null;
  add("类目", categoryPath);
  add("品牌", asRecord(fact.brand).value);
  add("采购价", text(asRecord(fact.purchaseCny).value) ? `${text(asRecord(fact.purchaseCny).value)} CNY` : null);
  const logistics = asRecord(fact.logistics);
  add("起批量", logistics.minOrderQuantity);
  add("发货地", logistics.shipFrom);

  const properties = Array.isArray(fact.properties) ? fact.properties : Array.isArray(raw.properties) ? raw.properties : [];
  for (const property of properties) {
    const item = asRecord(property);
    add(text(item.name) ?? "属性", item.value);
  }

  const priceTiers = Array.isArray(fact.priceTiers) ? fact.priceTiers : [];
  for (const tier of priceTiers.slice(0, 3)) {
    const item = asRecord(tier);
    add(`价格 ${text(item.minQuantity) ?? 1}件起`, text(item.priceCny) ? `${text(item.priceCny)} CNY` : null);
  }

  const skus = Array.isArray(fact.skus) ? fact.skus : Array.isArray(raw.skus) ? raw.skus : [];
  return {
    attributes: rows.slice(0, 24),
    skus: skus.slice(0, 8).map((sku) => {
      const item = asRecord(sku);
      const attrs = asRecord(item.attributes);
      const nameFromAttrs = Object.values(attrs).map(text).filter(Boolean).join(" / ");
      return {
        name: text(item.name) ?? (nameFromAttrs || "默认规格"),
        priceCny: text(item.priceCny),
        stockText: text(item.stockText),
      };
    }),
  };
}

export default async function WorkflowPage() {
  const user = await requireUser();
  const tenantId = user.tenantId;

  if (!tenantId) {
    return <PageHeader title="自动化工作流" description="管理员账号请进入平台管理。" />;
  }

  const [credentials, snapshots, products, drafts, jobs] = await Promise.all([
    prisma.source1688Credential.findMany({
      where: { tenantId, status: "active" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.shopProductSnapshot.findMany({
      where: { tenantId, followStatus: "NEW" },
      orderBy: { lastSeenAt: "desc" },
      take: 6,
      include: { shop: true },
    }),
    prisma.sourceProduct.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      take: 9,
      include: {
        shop: true,
        productAssets: { orderBy: [{ sortOrder: "asc" }] },
        productFacts: { orderBy: { createdAt: "desc" }, take: 1 },
        listingJobs: { orderBy: { createdAt: "desc" }, take: 1 },
        ozonDrafts: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { productAssets: true } },
      },
    }),
    prisma.ozonDraft.findMany({
      where: { tenantId, status: { in: ["COMPILED", "SUBMITTED", "FAILED"] } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 20,
      include: {
        product: {
          include: {
            productAssets: { orderBy: [{ sortOrder: "asc" }] },
            productFacts: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
        store: true,
      },
    }),
    prisma.listingJob.findMany({
      where: { tenantId, status: { in: ["RUNNING", "FAILED", "SUCCEEDED"] } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        product: true,
        store: true,
        steps: { orderBy: { stepIndex: "desc" }, take: 1 },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="自动化工作流"
        description="按选品、审核、上架、监控四步处理商品，运营人员不用在多个页面之间来回找。"
      />
      <WorkflowWizard
        credentials={credentials.map((cred) => ({
          id: cred.id,
          name: cred.name ?? cred.id,
        }))}
        snapshots={snapshots.map((item) => ({
          id: item.id,
          title: item.title ?? item.offerId,
          offerId: item.offerId,
          imageUrl: item.imageUrl,
          priceText: item.priceText,
          shopName: item.shop.shopName,
          url: item.url,
          lastSeenAt: item.lastSeenAt.toISOString(),
        }))}
        products={products.map((product) => {
          const latestJob = product.listingJobs[0];
          const latestDraft = product.ozonDrafts[0];
          const info = productAttributes(product);
          return {
            id: product.id,
            title: product.title ?? product.offerId,
            offerId: product.offerId,
            sourceUrl: product.sourceUrl,
            imageUrl: preferredProductImageUrl(product.productAssets),
            imageUrls: productImageUrls(product.productAssets),
            shopName: product.shop?.shopName ?? "-",
            assetCount: product._count.productAssets,
            latestJobId: latestJob?.id ?? null,
            latestJobStatus: latestJob?.status ?? null,
            latestDraftId: latestDraft?.id ?? null,
            latestDraftStatus: latestDraft?.status ?? null,
            priceRub: latestDraft?.priceRub?.toString() ?? null,
            attributes: info.attributes,
            skus: info.skus,
          };
        })}
        drafts={drafts.map((draft) => {
          const info = productAttributes(draft.product);
          return {
            id: draft.id,
            productId: draft.productId,
            title: draft.titleRu ?? draft.product.title ?? draft.product.offerId,
            offerId: draft.product.offerId,
            sourceUrl: draft.product.sourceUrl,
            imageUrl: preferredProductImageUrl(draft.product.productAssets),
            imageUrls: productImageUrls(draft.product.productAssets),
            storeName: draft.store.name,
            priceRub: draft.priceRub?.toString() ?? null,
            status: draft.status,
            attributes: info.attributes,
            skus: info.skus,
          };
        })}
        jobs={jobs.map((job) => ({
          id: job.id,
          productId: job.productId,
          title: job.product.title ?? job.product.offerId,
          offerId: job.product.offerId,
          storeName: job.store.name,
          status: job.status,
          stepName: job.steps[0]?.stepName ?? null,
          error: job.error,
        }))}
      />
    </div>
  );
}
