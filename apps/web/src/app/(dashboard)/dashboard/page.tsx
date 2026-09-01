import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  PackageCheck,
  Store,
} from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, EmptyState, MetricCard, PageHeader, SectionHeader, Table } from "@/components/ui";
import { PublishDraftButton } from "@/components/api-actions";
import { RunButton } from "@/components/run-button";
import { StatusBadge } from "@/components/status";

export default async function DashboardPage() {
  const user = await requireUser();
  const tenantId = user.tenantId;

  if (!tenantId) {
    return <PageHeader title="平台管理" description="请从设置进入平台管理。" />;
  }

  const [
    productCount,
    newSnapshotCount,
    compiledDraftCount,
    failedJobCount,
    productsWithoutDraftCount,
    productsWithoutDraft,
    draftsToPublish,
    failedJobs,
    storeCount,
    xiangjiCount,
    pricingRuleCount,
    source1688Count,
  ] = await Promise.all([
    prisma.sourceProduct.count({ where: { tenantId } }),
    prisma.shopProductSnapshot.count({ where: { tenantId, followStatus: "NEW" } }),
    prisma.ozonDraft.count({ where: { tenantId, status: "COMPILED" } }),
    prisma.listingJob.count({ where: { tenantId, status: "FAILED" } }),
    prisma.sourceProduct.count({ where: { tenantId, ozonDrafts: { none: {} } } }),
    prisma.sourceProduct.findMany({
      where: { tenantId, ozonDrafts: { none: {} } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: {
        shop: true,
        productAssets: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }], take: 1 },
      },
    }),
    prisma.ozonDraft.findMany({
      where: { tenantId, status: "COMPILED" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: {
        product: { include: { productAssets: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }], take: 1 } } },
        store: true,
      },
    }),
    prisma.listingJob.findMany({
      where: { tenantId, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { product: true, store: true },
    }),
    prisma.store.count({ where: { tenantId } }),
    prisma.xiangjiCredential.count({ where: { tenantId } }),
    prisma.pricingRule.count({ where: { tenantId } }),
    prisma.source1688Credential.count({ where: { tenantId } }),
  ]);

  const setupReady = storeCount > 0 && xiangjiCount > 0 && pricingRuleCount > 0 && source1688Count > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="工作台"
        description="从这里处理每日上架任务：采集新品、生成草稿、确认发布和排查失败任务。"
      >
        <Link className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700" href="/shops">
          <Store className="h-4 w-4" aria-hidden="true" />
          去采集选品
        </Link>
      </PageHeader>

      {!setupReady ? (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-medium text-amber-950">系统还差一点配置才能完整上架</div>
              <div className="mt-1 text-sm text-amber-800">
                配置集中在设置页；完成后，运营人员主要使用采集选品、商品池和待发布页面。
              </div>
            </div>
            <Link className="inline-flex h-9 items-center rounded-md bg-amber-600 px-3 text-sm font-medium text-white hover:bg-amber-700" href="/settings">
              去完成设置
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="待选新品" value={newSnapshotCount} description="从 1688 店铺采集后待确认" icon={<Store className="h-4 w-4" />} tone="blue" />
        <MetricCard title="待生成草稿" value={productsWithoutDraftCount} description="商品池中还未生成草稿" icon={<Boxes className="h-4 w-4" />} tone="violet" />
        <MetricCard title="待发布草稿" value={compiledDraftCount} description="已生成，等人工确认" icon={<PackageCheck className="h-4 w-4" />} tone="green" />
        <MetricCard title="失败任务" value={failedJobCount} description="需要处理或重试" icon={<AlertTriangle className="h-4 w-4" />} tone={failedJobCount > 0 ? "red" : "gray"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { href: "/shops", title: "采集选品", desc: "导入 1688 店铺新品，勾选要上架的商品。", icon: Store },
          { href: "/products", title: "商品池", desc: "查看已选商品，批量生成 Ozon 草稿。", icon: Boxes },
          { href: "/drafts", title: "待发布", desc: "集中确认已经编译好的 Ozon 草稿。", icon: PackageCheck },
          { href: "/jobs", title: "任务记录", desc: "查看生成进度、失败原因和历史记录。", icon: ClipboardList },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="group">
              <Card className="h-full p-4 transition-shadow group-hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-md bg-blue-50 p-2 text-blue-700">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </div>
                <h2 className="mt-4 font-semibold text-gray-950">{item.title}</h2>
                <p className="mt-1 text-sm leading-6 text-gray-500">{item.desc}</p>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeader title="先处理这些商品" description="商品池中还没有草稿的商品，建议先生成草稿。" />
          {productsWithoutDraft.length === 0 ? (
            <EmptyState title="没有待生成草稿的商品" description="去采集选品页导入更多商品，或查看待发布草稿。" />
          ) : (
            <Table head={["商品", "店铺", "操作"]}>
              {productsWithoutDraft.map((product) => {
                const imageUrl = product.productAssets[0]?.publicUrl ?? product.productAssets[0]?.sourceUrl ?? null;
                return (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex min-w-[260px] items-center gap-3">
                        {imageUrl ? <img src={imageUrl} alt="" className="h-12 w-12 rounded-md object-cover" /> : <div className="h-12 w-12 rounded-md bg-gray-100" />}
                        <div className="min-w-0">
                          <Link href={`/products/${product.id}`} className="line-clamp-2 font-medium text-gray-950 hover:text-blue-700">
                            {product.title ?? product.offerId}
                          </Link>
                          <div className="text-xs text-gray-500">{product.offerId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{product.shop?.shopName ?? "-"}</td>
                    <td className="px-4 py-3"><RunButton productId={product.id} /></td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card>
          <SectionHeader
            title="待确认发布"
            description="草稿已经生成，确认后才会提交；真实发布仍受安全开关控制。"
            children={<Link href="/drafts" className="text-sm font-medium text-blue-700 hover:underline">查看全部</Link>}
          />
          {draftsToPublish.length === 0 ? (
            <EmptyState title="暂无待发布草稿" description="生成草稿后会出现在这里。" />
          ) : (
            <Table head={["草稿商品", "店铺", "价格", "操作"]}>
              {draftsToPublish.map((draft) => {
                const imageUrl = draft.product.productAssets[0]?.publicUrl ?? draft.product.productAssets[0]?.sourceUrl ?? null;
                return (
                  <tr key={draft.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex min-w-[260px] items-center gap-3">
                        {imageUrl ? <img src={imageUrl} alt="" className="h-12 w-12 rounded-md object-cover" /> : <div className="h-12 w-12 rounded-md bg-gray-100" />}
                        <div className="min-w-0">
                          <Link href={`/products/${draft.productId}`} className="line-clamp-2 font-medium text-gray-950 hover:text-blue-700">
                            {draft.titleRu ?? draft.product.title ?? draft.product.offerId}
                          </Link>
                          <div className="text-xs text-gray-500">{draft.product.offerId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{draft.store.name}</td>
                    <td className="px-4 py-3">{draft.priceRub ? `${draft.priceRub.toString()} RUB` : "-"}</td>
                    <td className="px-4 py-3"><PublishDraftButton draftId={draft.id} /></td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>

      {failedJobs.length > 0 ? (
        <Card className="border-red-200">
          <SectionHeader title="失败任务" description="失败任务会影响商品上架，建议优先查看原因。" />
          <Table head={["商品", "店铺", "状态", "错误", "操作"]}>
            {failedJobs.map((job) => (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/products/${job.productId}`} className="font-medium text-gray-950 hover:text-blue-700">
                    {job.product.title ?? job.product.offerId}
                  </Link>
                </td>
                <td className="px-4 py-3">{job.store.name}</td>
                <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                <td className="max-w-md truncate px-4 py-3 text-red-700">{job.error ?? "-"}</td>
                <td className="px-4 py-3">
                  <Link href={`/jobs/${job.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                    查看任务
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
