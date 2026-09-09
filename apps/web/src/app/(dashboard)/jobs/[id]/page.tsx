import Link from "next/link";
import { ArrowLeft, PackageSearch } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Card, EmptyState, MetricCard, PageHeader, ProgressBar, SectionHeader, Table, cn } from "@/components/ui";
import { PostButton, PublishDraftButton } from "@/components/api-actions";
import { StatusBadge, statusLabel, stepLabel } from "@/components/status";

export default async function JobDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="任务详情" description="管理员账号请进入平台管理。" />;
  }

  const job = await prisma.listingJob.findFirst({
    where: { tenantId: user.tenantId, id: params.id },
    include: {
      product: true,
      store: true,
      steps: { orderBy: { stepIndex: "asc" } },
      ozonDrafts: { include: { publishRuns: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!job) return <PageHeader title="任务不存在" />;

  const completedSteps = job.steps.filter((step) => step.status === "SUCCEEDED").length;
  const progress = job.steps.length ? Math.round((completedSteps / job.steps.length) * 100) : 0;
  const activeStep = job.steps.find((step) => step.status === "RUNNING")
    ?? [...job.steps].reverse().find((step) => step.status === "FAILED" || step.status === "SUCCEEDED")
    ?? job.steps[0];

  return (
    <div className="space-y-6">
      <PageHeader title="任务详情" description={job.product.title ?? job.product.offerId}>
        <Link href="/jobs" className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          任务记录
        </Link>
        <Link href={`/products/${job.productId}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <PackageSearch className="h-4 w-4" aria-hidden="true" />
          商品详情
        </Link>
        {job.status === "FAILED" ? <PostButton path={`/api/v1/jobs/${job.id}/retry`} label="重试任务" /> : null}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="任务状态" value={statusLabel(job.status)} description={job.error ?? "当前处理状态"} tone={job.status === "FAILED" ? "red" : job.status === "SUCCEEDED" ? "green" : "blue"} />
        <MetricCard title="当前处理" value={activeStep ? stepLabel(activeStep.stepName) : "-"} description={activeStep ? `第 ${activeStep.stepIndex + 1} 步` : "暂无步骤"} />
        <MetricCard title="Ozon 店铺" value={job.store.name} description="草稿目标店铺" />
        <MetricCard title="进度" value={`${progress}%`} description={`${completedSteps} / ${job.steps.length} 步完成`} />
      </div>

      <Card>
        <SectionHeader title="处理进度" description="如果任务失败，优先查看标红步骤的错误信息。" />
        <div className="mb-5">
          <ProgressBar value={progress} />
        </div>
        <div className="space-y-3">
          {job.steps.map((step) => (
            <div key={step.id} className={cn("grid gap-3 rounded-lg border p-3 md:grid-cols-[44px_minmax(0,1fr)_140px_180px]", step.status === "FAILED" ? "border-red-200 bg-red-50" : "border-gray-200 bg-white")}>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                {step.stepIndex + 1}
              </div>
              <div className="min-w-0">
                <div className="font-medium text-gray-950">{stepLabel(step.stepName)}</div>
                {step.error ? <div className="mt-1 text-sm text-red-700">{step.error}</div> : null}
              </div>
              <div><StatusBadge status={step.status} /></div>
              <div className="text-sm text-gray-500">
                {step.startedAt?.toLocaleString("zh-CN") ?? "-"}
                {step.finishedAt ? <span className="block">{step.finishedAt.toLocaleString("zh-CN")}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionHeader title="生成的 Ozon 草稿" description="草稿为待发布时，可以由运营人员确认上架。" />
        {job.ozonDrafts.length === 0 ? (
          <EmptyState title="暂无草稿" description="任务完成草稿生成后会显示在这里。" />
        ) : (
          <Table head={["状态", "俄文标题", "价格", "发布记录", "操作"]}>
            {job.ozonDrafts.map((draft) => (
              <tr key={draft.id} className="hover:bg-gray-50">
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
        <SectionHeader title="发布记录" description="真实发布仍受 ENABLE_REAL_OZON_SUBMIT 安全开关控制。" />
        {job.ozonDrafts.flatMap((draft) => draft.publishRuns).length === 0 ? (
          <EmptyState title="暂无发布记录" />
        ) : (
          <Table head={["Ozon 任务号", "请求标识", "状态", "提交时间"]}>
            {job.ozonDrafts.flatMap((draft) =>
              draft.publishRuns.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{run.ozonTaskId ?? "-"}</td>
                  <td className="max-w-xs truncate px-4 py-3 font-mono text-xs">{run.requestHash}</td>
                  <td className="px-4 py-3">{run.status}</td>
                  <td className="px-4 py-3">{run.submittedAt.toLocaleString("zh-CN")}</td>
                </tr>
              )),
            )}
          </Table>
        )}
      </Card>
    </div>
  );
}
