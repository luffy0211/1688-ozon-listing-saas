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
          };
        })}
        drafts={drafts.map((draft) => {
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
