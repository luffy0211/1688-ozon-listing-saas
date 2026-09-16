import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { EmptyState, MetricCard, PageHeader, Table } from "@/components/ui";
import { StatusBadge, stepLabel } from "@/components/status";

export default async function JobsPage() {
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="任务记录" description="管理员账号请进入平台管理。" />;
  }

  const [jobs, runningCount, failedCount, succeededCount] = await Promise.all([
    prisma.listingJob.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        product: true,
        store: true,
        steps: { orderBy: { stepIndex: "asc" } },
        ozonDrafts: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.listingJob.count({ where: { tenantId: user.tenantId, status: "RUNNING" } }),
    prisma.listingJob.count({ where: { tenantId: user.tenantId, status: "FAILED" } }),
    prisma.listingJob.count({ where: { tenantId: user.tenantId, status: "SUCCEEDED" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="任务记录"
        description="查看自动上架进度、失败原因和历史处理结果。"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="处理中" value={runningCount} icon={<ClipboardList className="h-4 w-4" />} tone="amber" />
        <MetricCard title="失败" value={failedCount} tone={failedCount > 0 ? "red" : "gray"} />
        <MetricCard title="已完成" value={succeededCount} tone="green" />
      </div>

      {jobs.length === 0 ? (
        <EmptyState title="暂无任务记录" description="在商品池点击立即上架后，处理记录会出现在这里。" />
      ) : (
        <Table head={["任务", "商品", "店铺", "状态", "当前处理", "发布", "创建时间"]}>
          {jobs.map((job) => {
            const activeStep = job.steps.find((step) => step.status === "RUNNING")
              ?? [...job.steps].reverse().find((step) => step.status === "SUCCEEDED" || step.status === "FAILED")
              ?? job.steps[0];
            const latestDraft = job.ozonDrafts[0];

            return (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/jobs/${job.id}`} className="font-mono text-xs text-blue-700 hover:underline">
                    {job.id}
                  </Link>
                </td>
                <td className="max-w-sm px-4 py-3">
                  <Link href={`/products/${job.productId}`} className="line-clamp-2 font-medium text-gray-950 hover:text-blue-700">
                    {job.product.title ?? job.product.offerId}
                  </Link>
                  <div className="mt-1 text-xs text-gray-500">{job.product.offerId}</div>
                </td>
                <td className="px-4 py-3">{job.store.name}</td>
                <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                <td className="px-4 py-3">{activeStep ? stepLabel(activeStep.stepName) : "-"}</td>
                <td className="px-4 py-3"><StatusBadge status={latestDraft?.status} /></td>
                <td className="px-4 py-3 text-gray-500">{job.createdAt.toLocaleString("zh-CN")}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
