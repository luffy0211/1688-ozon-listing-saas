import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { preferredProductImageUrl } from "@/lib/product-image";
import { EmptyState, MetricCard, PageHeader } from "@/components/ui";
import { ProductDataTable, type ProductTableRow } from "@/components/product-data-table";

export default async function ProductsPage() {
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="商品池" description="管理员账号请进入平台管理。" />;
  }

  const [products, total, pendingDrafts, failedJobs] = await Promise.all([
    prisma.sourceProduct.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { updatedAt: "desc" },
      include: {
        shop: true,
        productAssets: { orderBy: [{ sortOrder: "asc" }] },
        listingJobs: { orderBy: { createdAt: "desc" }, take: 1 },
        ozonDrafts: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { productAssets: true, ozonDrafts: true } },
      },
    }),
    prisma.sourceProduct.count({ where: { tenantId: user.tenantId } }),
    prisma.ozonDraft.count({ where: { tenantId: user.tenantId, status: "COMPILED" } }),
    prisma.listingJob.count({ where: { tenantId: user.tenantId, status: "FAILED" } }),
  ]);

  const rows: ProductTableRow[] = products.map((product) => {
    const latestJob = product.listingJobs[0];
    const latestDraft = product.ozonDrafts[0];
    return {
      id: product.id,
      title: product.title ?? product.offerId,
      offerId: product.offerId,
      sourceUrl: product.sourceUrl,
      shopName: product.shop?.shopName ?? "-",
      imageUrl: preferredProductImageUrl(product.productAssets),
      assetCount: product._count.productAssets,
      draftCount: product._count.ozonDrafts,
      latestJobId: latestJob?.id ?? null,
      latestJobStatus: latestJob?.status ?? null,
      latestDraftId: latestDraft?.id ?? null,
      latestDraftStatus: latestDraft?.status ?? null,
      priceRub: latestDraft?.priceRub ? `${latestDraft.priceRub.toString()} RUB` : null,
      updatedAt: product.updatedAt.toISOString(),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="商品池"
        description="管理已经选入池的商品，批量转换并提交到 Ozon。"
      >
        <Link className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700" href="/shops">
          <Plus className="h-4 w-4" aria-hidden="true" />
          去采集选品
        </Link>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="全部商品" value={total} description="当前商品池总数" />
        <MetricCard title="待提交记录" value={pendingDrafts} description="后台提交中或历史停留记录" tone="green" />
        <MetricCard title="失败任务" value={failedJobs} description="需要查看任务记录" tone={failedJobs > 0 ? "red" : "gray"} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="商品池为空" description="先采集 1688 店铺，再选择商品导入商品池。">
          <Link className="inline-flex h-9 items-center rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700" href="/shops">
            去采集选品
          </Link>
        </EmptyState>
      ) : (
        <ProductDataTable rows={rows} />
      )}
    </div>
  );
}
