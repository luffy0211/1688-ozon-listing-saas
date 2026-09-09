import Link from "next/link";
import { ExternalLink, Images, PackageCheck } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, EmptyState, MetricCard, PageHeader, ProgressBar, SectionHeader, Table } from "@/components/ui";
import { PublishDraftButton } from "@/components/api-actions";
import { RunButton } from "@/components/run-button";
import { StatusBadge, stepLabel } from "@/components/status";

function jsonPreview(value: unknown) {
  if (!value) return "{}";
  return JSON.stringify(value, null, 2);
}

export default async function ProductDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="商品详情" description="管理员账号请进入平台管理。" />;
  }

  const product = await prisma.sourceProduct.findFirst({
    where: { tenantId: user.tenantId, id: params.id },
    include: {
      shop: true,
      productFacts: { orderBy: { createdAt: "desc" }, take: 1 },
      productAssets: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
      ozonDrafts: {
        orderBy: { createdAt: "desc" },
        include: { publishRuns: { orderBy: { createdAt: "desc" } }, store: true },
      },
      listingJobs: { orderBy: { createdAt: "desc" }, include: { steps: { orderBy: { stepIndex: "asc" } }, store: true } },
    },
  });
  if (!product) return <PageHeader title="商品不存在" />;

  const latestJob = product.listingJobs[0];
  const latestDraft = product.ozonDrafts[0];
  const completedSteps = latestJob?.steps.filter((step) => step.status === "SUCCEEDED").length ?? 0;
  const progress = latestJob?.steps.length ? Math.round((completedSteps / latestJob.steps.length) * 100) : 0;
  const images = product.productAssets.filter((asset) => asset.kind.includes("image"));

  return (
    <div className="space-y-6">
      <PageHeader title={product.title ?? product.offerId} description={`Offer ID: ${product.offerId}`}>
        <Link href="/products" className="inline-flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
          返回商品池
        </Link>
        {product.sourceUrl ? (
          <a className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50" href={product.sourceUrl} target="_blank">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            打开 1688
          </a>
        ) : null}
        {latestDraft?.status === "COMPILED" ? <PublishDraftButton draftId={latestDraft.id} /> : <RunButton productId={product.id} />}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="来源店铺" value={product.shop?.shopName ?? "-"} description={product.capturedAt?.toLocaleString("zh-CN") ?? "未记录采集时间"} />
        <MetricCard title="图片" value={product.productAssets.length} description="可用于草稿的图片资产" icon={<Images className="h-4 w-4" />} tone="violet" />
        <MetricCard title="任务状态" value={latestJob ? latestJob.status : "-"} description={latestJob ? `${progress}% 完成` : "尚未生成草稿"} tone={latestJob?.status === "FAILED" ? "red" : "blue"} />
        <MetricCard title="草稿状态" value={latestDraft ? latestDraft.status : "-"} description={latestDraft?.priceRub ? `${latestDraft.priceRub.toString()} RUB` : "暂无售价"} icon={<PackageCheck className="h-4 w-4" />} tone={latestDraft?.status === "COMPILED" ? "green" : "gray"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <SectionHeader title="商品图片" description="运营检查优先看主图和详情图是否足够。" />
            {images.length === 0 ? (
              <EmptyState title="暂无图片" />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {images.slice(0, 12).map((asset) => {
                  const src = asset.publicUrl ?? asset.sourceUrl;
                  return src ? (
                    <a key={asset.id} href={src} target="_blank" className="group">
                      <img src={src} alt="" className="aspect-square w-full rounded-md border object-cover transition-opacity group-hover:opacity-80" />
                      <div className="mt-1 truncate text-xs text-gray-500">{asset.kind}</div>
                    </a>
                  ) : null;
                })}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeader title="Ozon 草稿" description="待发布草稿可以直接确认上架；其他状态先查看任务记录。" />
            {product.ozonDrafts.length === 0 ? (
              <EmptyState title="还没有草稿" description="点击生成草稿后，系统会翻译、定价并生成 Ozon 提交数据。" />
            ) : (
              <Table head={["店铺", "状态", "俄文标题", "价格", "发布记录", "操作"]}>
                {product.ozonDrafts.map((draft) => (
                  <tr key={draft.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{draft.store.name}</td>
                    <td className="px-4 py-3"><StatusBadge status={draft.status} /></td>
                    <td className="max-w-md px-4 py-3">{draft.titleRu ?? "-"}</td>
                    <td className="px-4 py-3">{draft.priceRub ? `${draft.priceRub.toString()} RUB` : "-"}</td>
                    <td className="px-4 py-3">{draft.publishRuns.length}</td>
                    <td className="px-4 py-3">
                      {draft.status === "COMPILED" ? <PublishDraftButton draftId={draft.id} /> : "-"}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card>
            <SectionHeader title="历史任务" description="查看这个商品生成草稿的历史记录。" />
            {product.listingJobs.length === 0 ? (
              <EmptyState title="暂无任务记录" />
            ) : (
              <Table head={["任务", "店铺", "状态", "进度", "时间"]}>
                {product.listingJobs.map((job) => {
                  const done = job.steps.filter((step) => step.status === "SUCCEEDED").length;
                  const jobProgress = job.steps.length ? Math.round((done / job.steps.length) * 100) : 0;
                  return (
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link className="font-mono text-xs text-blue-700 hover:underline" href={`/jobs/${job.id}`}>
                          {job.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{job.store.name}</td>
                      <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                      <td className="px-4 py-3">{jobProgress}%</td>
                      <td className="px-4 py-3 text-gray-500">{job.createdAt.toLocaleString("zh-CN")}</td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <SectionHeader title="最近处理进度" description={latestJob ? latestJob.store.name : undefined} />
            {latestJob ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={latestJob.status} />
                  <Link href={`/jobs/${latestJob.id}`} className="text-sm font-medium text-blue-700 hover:underline">查看任务</Link>
                </div>
                <ProgressBar value={progress} />
                <div className="space-y-2">
                  {latestJob.steps.slice(0, 6).map((step) => (
                    <div key={step.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-gray-700">{stepLabel(step.stepName)}</span>
                      <StatusBadge status={step.status} />
                    </div>
                  ))}
                </div>
                {latestJob.error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{latestJob.error}</div> : null}
              </div>
            ) : (
              <EmptyState title="尚未生成任务" />
            )}
          </Card>

          <Card>
            <SectionHeader title="来源信息" />
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">来源店铺</dt>
                <dd className="mt-1 font-medium text-gray-950">{product.shop?.shopName ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">商品状态</dt>
                <dd className="mt-1"><Badge>{product.status}</Badge></dd>
              </div>
              <div>
                <dt className="text-gray-500">来源链接</dt>
                <dd className="mt-1 break-all text-gray-700">{product.sourceUrl ?? "-"}</dd>
              </div>
            </dl>
          </Card>

          <details className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-gray-950">调试数据</summary>
            <pre className="mt-4 max-h-96 overflow-auto rounded-md bg-gray-950 p-4 text-xs leading-5 text-gray-100">
              {jsonPreview(product.productFacts[0]?.normalizedJson)}
            </pre>
          </details>
        </aside>
      </div>
    </div>
  );
}
