import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { preferredProductImageUrl } from "@/lib/product-image";
import { EmptyState, MetricCard, PageHeader, Table } from "@/components/ui";
import { PublishDraftButton } from "@/components/api-actions";
import { StatusBadge } from "@/components/status";

export default async function DraftsPage() {
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="待发布" description="管理员账号请进入平台管理。" />;
  }

  const [drafts, pendingCount, submittedCount, failedCount] = await Promise.all([
    prisma.ozonDraft.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [
        { status: "asc" },
        { updatedAt: "desc" },
      ],
      take: 100,
      include: {
        product: {
          include: {
            shop: true,
            productAssets: { orderBy: [{ sortOrder: "asc" }] },
          },
        },
        store: true,
        publishRuns: { orderBy: { submittedAt: "desc" }, take: 1 },
      },
    }),
    prisma.ozonDraft.count({ where: { tenantId: user.tenantId, status: "COMPILED" } }),
    prisma.ozonDraft.count({ where: { tenantId: user.tenantId, status: "SUBMITTED" } }),
    prisma.ozonDraft.count({ where: { tenantId: user.tenantId, status: "FAILED" } }),
  ]);

  const sortedDrafts = [...drafts].sort((a, b) => {
    const weight = { COMPILED: 0, FAILED: 1, DRAFT: 2, SUBMITTED: 3 } as Record<string, number>;
    return (weight[a.status] ?? 9) - (weight[b.status] ?? 9);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="待发布"
        description="集中检查已经生成的 Ozon 草稿；只有待发布状态的草稿会显示确认上架按钮。"
      >
        <Link className="inline-flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/products">
          返回商品池
        </Link>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="待发布" value={pendingCount} icon={<PackageCheck className="h-4 w-4" />} tone="green" />
        <MetricCard title="已提交" value={submittedCount} tone="blue" />
        <MetricCard title="草稿失败" value={failedCount} tone={failedCount > 0 ? "red" : "gray"} />
      </div>

      {sortedDrafts.length === 0 ? (
        <EmptyState title="暂无草稿" description="在商品池点击生成草稿，完成后会出现在这里。" />
      ) : (
        <Table head={["商品", "来源店铺", "Ozon 店铺", "状态", "价格", "最后发布", "操作"]}>
          {sortedDrafts.map((draft) => {
            const imageUrl = preferredProductImageUrl(draft.product.productAssets);
            const latestRun = draft.publishRuns[0];
            return (
              <tr key={draft.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex min-w-[320px] items-center gap-3">
                    {imageUrl ? <img src={imageUrl} alt="" className="h-12 w-12 rounded-md object-cover" /> : <div className="h-12 w-12 rounded-md bg-gray-100" />}
                    <div className="min-w-0">
                      <Link href={`/products/${draft.productId}`} className="line-clamp-2 font-medium text-gray-950 hover:text-blue-700">
                        {draft.titleRu ?? draft.product.title ?? draft.product.offerId}
                      </Link>
                      <div className="mt-1 text-xs text-gray-500">{draft.product.offerId}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{draft.product.shop?.shopName ?? "-"}</td>
                <td className="px-4 py-3">{draft.store.name}</td>
                <td className="px-4 py-3"><StatusBadge status={draft.status} /></td>
                <td className="px-4 py-3">{draft.priceRub ? `${draft.priceRub.toString()} RUB` : "-"}</td>
                <td className="px-4 py-3 text-gray-500">{latestRun?.submittedAt.toLocaleString("zh-CN") ?? "-"}</td>
                <td className="px-4 py-3">
                  {draft.status === "COMPILED" ? (
                    <PublishDraftButton draftId={draft.id} />
                  ) : (
                    <Link href={`/products/${draft.productId}`} className="text-sm font-medium text-blue-700 hover:underline">
                      查看商品
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
