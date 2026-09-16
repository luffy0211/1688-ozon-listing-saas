import { CheckCircle2, ShieldCheck, Timer, XCircle } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { AgentActionCenter, type AgentActionCenterItem } from "@/components/agent-action-center";
import { MetricCard, PageHeader } from "@/components/ui";

export default async function AgentActionsPage() {
  const user = await requireUser();
  const tenantId = user.tenantId;
  if (!tenantId) return <PageHeader title="待审批" description="平台管理员没有租户动作。" />;

  const [actions, pendingCount, executedCount, failedCount] = await Promise.all([
    prisma.agentAction.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    prisma.agentAction.count({ where: { tenantId, status: "PENDING_APPROVAL" } }),
    prisma.agentAction.count({ where: { tenantId, status: "EXECUTED" } }),
    prisma.agentAction.count({ where: { tenantId, status: { in: ["FAILED", "BLOCKED", "REJECTED"] } } }),
  ]);

  const serialized: AgentActionCenterItem[] = actions.map((action) => ({
    id: action.id,
    type: action.type,
    status: action.status,
    riskLevel: action.riskLevel,
    title: action.title,
    rationale: action.rationale,
    offerId: action.offerId,
    productId: action.productId,
    error: action.error,
    createdAt: action.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="待审批"
        description="Agent 只能生成建议；改标题、改属性、调价、活动报名和上架都需要人工确认后才会执行。"
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="总动作" value={actions.length} description="最近 80 条" icon={<ShieldCheck className="h-4 w-4" />} tone="blue" />
        <MetricCard title="待确认" value={pendingCount} description="需要人工处理" icon={<Timer className="h-4 w-4" />} tone={pendingCount ? "amber" : "gray"} />
        <MetricCard title="已执行" value={executedCount} description="已写入或规则已生效" icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
        <MetricCard title="失败/拒绝" value={failedCount} description="可回到 Agent 重新生成" icon={<XCircle className="h-4 w-4" />} tone={failedCount ? "red" : "gray"} />
      </div>

      <AgentActionCenter initialActions={serialized} />
    </div>
  );
}
