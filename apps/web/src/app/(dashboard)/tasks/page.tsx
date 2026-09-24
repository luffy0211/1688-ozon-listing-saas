import Link from "next/link";
import { Bot, ClipboardList, PackageCheck, RefreshCcw, Store } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, EmptyState, MetricCard, PageHeader, SectionHeader, Table } from "@/components/ui";
import { StatusBadge } from "@/components/status";

function formatDate(value: Date | null | undefined) {
  return value ? value.toLocaleString("zh-CN") : "-";
}

function statusTone(status: string): "gray" | "green" | "red" | "amber" | "blue" | "violet" {
  if (["SUCCEEDED", "submitted", "EXECUTED"].includes(status)) return "green";
  if (["FAILED", "failed"].includes(status)) return "red";
  if (["RUNNING", "PENDING"].includes(status)) return "amber";
  return "gray";
}

export default async function TasksPage() {
  const user = await requireUser();
  const tenantId = user.tenantId;
  if (!tenantId) return <PageHeader title="任务中心" description="平台管理员没有租户任务。" />;

  const [listingJobs, publishRuns, agentRuns, syncRuns, runningCount, failedCount] = await Promise.all([
    prisma.listingJob.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      take: 30,
      include: { product: true, store: true },
    }),
    prisma.publishRun.findMany({
      where: { tenantId },
      orderBy: { submittedAt: "desc" },
      take: 20,
      include: { draft: { include: { product: true } }, store: true },
    }),
    prisma.agentRun.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actions: true },
    }),
    prisma.shopSyncRun.findMany({
      where: { tenantId },
      orderBy: { startedAt: "desc" },
      take: 20,
      include: { shop: true },
    }),
    prisma.listingJob.count({ where: { tenantId, status: { in: ["PENDING", "RUNNING"] } } }),
    prisma.listingJob.count({ where: { tenantId, status: "FAILED" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="任务中心" description="集中查看采集、上架、发布和 Agent 运行状态；失败任务优先处理。" />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="上架任务" value={listingJobs.length} description="最近 30 条" icon={<ClipboardList className="h-4 w-4" />} tone="blue" />
        <MetricCard title="运行中" value={runningCount} description="等待 worker 处理" icon={<RefreshCcw className="h-4 w-4" />} tone={runningCount ? "amber" : "gray"} />
        <MetricCard title="失败上架" value={failedCount} description="需要查看原因" icon={<PackageCheck className="h-4 w-4" />} tone={failedCount ? "red" : "green"} />
        <MetricCard title="Agent 运行" value={agentRuns.length} description="最近 20 次" icon={<Bot className="h-4 w-4" />} tone="violet" />
      </div>

      <Card>
        <SectionHeader title="上架流水线" description="商品从资料生成到 Ozon 提交的后台任务。" />
        {listingJobs.length === 0 ? (
          <EmptyState title="暂无上架任务" description="进入自动化工作流选择商品后，会在这里显示进度。" />
        ) : (
          <Table head={["商品", "店铺", "状态", "当前步骤", "更新时间", "错误", "操作"]}>
            {listingJobs.map((job) => (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="min-w-[260px] px-4 py-3">
                  <Link href={`/products/${job.productId}`} className="font-semibold text-gray-950 hover:text-blue-700">
                    {job.product.title ?? job.product.offerId}
                  </Link>
                  <div className="text-xs text-gray-500">{job.product.offerId}</div>
                </td>
                <td className="px-4 py-3">{job.store.name}</td>
                <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                <td className="px-4 py-3">{job.currentStep}</td>
                <td className="px-4 py-3">{formatDate(job.updatedAt)}</td>
                <td className="max-w-sm truncate px-4 py-3 text-red-700">{job.error ?? "-"}</td>
                <td className="px-4 py-3">
                  <Link href={`/jobs/${job.id}`} className="text-sm font-semibold text-blue-700 hover:underline">查看</Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeader title="Ozon 发布记录" description="包含 mock 和真实提交记录；真实提交受安全开关控制。" />
          {publishRuns.length === 0 ? (
            <EmptyState title="暂无发布记录" description="生成草稿并提交后会出现在这里。" />
          ) : (
            <Table head={["商品", "店铺", "状态", "Task ID", "时间"]}>
              {publishRuns.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="min-w-[220px] px-4 py-3">
                    <Link href={`/products/${run.draft.productId}`} className="font-semibold text-gray-950 hover:text-blue-700">
                      {run.draft.product.title ?? run.draft.product.offerId}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{run.store.name}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(run.status)}>{run.status}</Badge></td>
                  <td className="px-4 py-3 font-mono text-xs">{run.ozonTaskId ?? "-"}</td>
                  <td className="px-4 py-3">{formatDate(run.submittedAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <SectionHeader title="采集任务" description="1688 店铺同步和新品发现结果。" />
          {syncRuns.length === 0 ? (
            <EmptyState title="暂无采集任务" description="采集店铺后会显示总数、新品数和错误。" />
          ) : (
            <Table head={["店铺", "状态", "总数", "新品", "时间", "错误"]}>
              {syncRuns.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="min-w-[180px] px-4 py-3">
                    <div className="font-semibold text-gray-950">{run.shop.shopName ?? run.shop.shopUrl}</div>
                  </td>
                  <td className="px-4 py-3"><Badge tone={statusTone(run.status)}>{run.status}</Badge></td>
                  <td className="px-4 py-3">{run.totalCount}</td>
                  <td className="px-4 py-3">{run.newCount}</td>
                  <td className="px-4 py-3">{formatDate(run.startedAt)}</td>
                  <td className="max-w-sm truncate px-4 py-3 text-red-700">{run.error ?? "-"}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <SectionHeader title="Agent 运行记录" description="用于判断 Agent 是否真实调用工具、是否生成了待审批动作。" />
        {agentRuns.length === 0 ? (
          <EmptyState title="暂无 Agent 运行" description="进入运营 Agent 发起诊断、竞品分析或活动报名后会出现在这里。" />
        ) : (
          <Table head={["请求", "状态", "模型", "动作数", "开始时间", "错误"]}>
            {agentRuns.map((run) => (
              <tr key={run.id} className="hover:bg-gray-50">
                <td className="max-w-xl truncate px-4 py-3">{run.input}</td>
                <td className="px-4 py-3"><Badge tone={statusTone(run.status)}>{run.status}</Badge></td>
                <td className="px-4 py-3">{run.model}</td>
                <td className="px-4 py-3">{run.actions.length}</td>
                <td className="px-4 py-3">{formatDate(run.startedAt)}</td>
                <td className="max-w-sm truncate px-4 py-3 text-red-700">{run.error ?? "-"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
