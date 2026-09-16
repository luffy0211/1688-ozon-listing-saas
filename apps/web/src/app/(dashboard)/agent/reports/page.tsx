import { Bot, FileText, Layers3, ScrollText } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, EmptyState, MetricCard, PageHeader, SectionHeader, Table } from "@/components/ui";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function categoryName(reportJson: unknown) {
  const report = asRecord(reportJson);
  const category = asRecord(report.category);
  const target = asRecord(report.target);
  return stringField(category.name) ?? stringField(target.title) ?? "-";
}

function competitorCount(reportJson: unknown) {
  const report = asRecord(reportJson);
  return Array.isArray(report.competitors) ? report.competitors.length : 0;
}

function capturedAt(reportJson: unknown) {
  const report = asRecord(reportJson);
  return stringField(report.capturedAt) ?? "-";
}

export default async function AgentReportsPage() {
  const user = await requireUser();
  const tenantId = user.tenantId;
  if (!tenantId) return <PageHeader title="Agent 报告" description="平台管理员没有租户报告。" />;

  const [reports, policyActions, competitorProducts, latestRuns] = await Promise.all([
    prisma.competitorContentReport.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.agentAction.findMany({
      where: { tenantId, type: "PROMOTION_POLICY" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.competitorProduct.count({ where: { tenantId } }),
    prisma.agentRun.findMany({
      where: { tenantId, status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent 报告"
        description="沉淀竞品证据、类目属性经验和活动报名规则，避免每次都只在聊天里找结论。"
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="竞品报告" value={reports.length} description="最近 50 份" icon={<FileText className="h-4 w-4" />} tone="blue" />
        <MetricCard title="竞品样本" value={competitorProducts} description="已入库的公开商品" icon={<Layers3 className="h-4 w-4" />} tone="violet" />
        <MetricCard title="活动规则" value={policyActions.length} description="已生成的报名 SOP" icon={<ScrollText className="h-4 w-4" />} tone="amber" />
        <MetricCard title="成功运行" value={latestRuns.length} description="最近成功 Agent 任务" icon={<Bot className="h-4 w-4" />} tone="green" />
      </div>

      <Card>
        <SectionHeader title="竞品分析与类目经验" description="用于后续全店诊断、属性映射和商品修改建议。" />
        {reports.length === 0 ? (
          <EmptyState title="暂无竞品报告" description="在运营 Agent 中发起“每个类目分析 N 个竞品”，报告会沉淀在这里。" />
        ) : (
          <Table head={["报告", "类目/目标", "竞品数", "来源", "采集时间", "创建时间"]}>
            {reports.map((report) => {
              const data = asRecord(report.reportJson);
              return (
                <tr key={report.id} className="hover:bg-gray-50">
                  <td className="max-w-md truncate px-4 py-3 font-semibold text-gray-950">{report.title}</td>
                  <td className="max-w-sm truncate px-4 py-3">{categoryName(report.reportJson)}</td>
                  <td className="px-4 py-3">{competitorCount(report.reportJson)}</td>
                  <td className="px-4 py-3"><Badge tone="blue">{stringField(data.source) ?? "unknown"}</Badge></td>
                  <td className="px-4 py-3">{capturedAt(report.reportJson)}</td>
                  <td className="px-4 py-3">{report.createdAt.toLocaleString("zh-CN")}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeader title="活动报名规则记忆" description="用户确认过的活动计算方法和筛选规则。" />
          {policyActions.length === 0 ? (
            <EmptyState title="暂无活动规则" description="让 Agent 编译活动报名 SOP 并确认后，会显示在这里。" />
          ) : (
            <Table head={["规则", "状态", "风险", "时间"]}>
              {policyActions.map((action) => (
                <tr key={action.id} className="hover:bg-gray-50">
                  <td className="max-w-md truncate px-4 py-3 font-semibold text-gray-950">{action.title}</td>
                  <td className="px-4 py-3"><Badge tone={action.status === "EXECUTED" ? "green" : "amber"}>{action.status}</Badge></td>
                  <td className="px-4 py-3">{action.riskLevel}</td>
                  <td className="px-4 py-3">{action.createdAt.toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <SectionHeader title="最近成功 Agent 输出" description="用于快速回看最近诊断、竞品或活动分析结果。" />
          {latestRuns.length === 0 ? (
            <EmptyState title="暂无成功运行" description="完成一次 Agent 对话后会显示摘要。" />
          ) : (
            <div className="space-y-3">
              {latestRuns.map((run) => (
                <div key={run.id} className="rounded-2xl border border-[#e3ebf5] bg-white p-4">
                  <div className="truncate text-sm font-semibold text-gray-950">{run.input}</div>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-gray-600">{run.output ?? "-"}</p>
                  <div className="mt-3 text-xs text-gray-500">{run.createdAt.toLocaleString("zh-CN")} · {run.model}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
