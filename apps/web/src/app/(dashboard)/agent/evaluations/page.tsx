import { Activity, CheckCircle2, ShieldCheck, Wrench } from "lucide-react";
import { agentEvalCases, summarizeAgentEvalCases } from "@/lib/agent/eval-set";
import { Badge, Card, MetricCard, PageHeader, SectionHeader, Table } from "@/components/ui";

const categoryLabels: Record<string, string> = {
  competitor_analysis: "竞品分析",
  store_diagnosis: "店铺诊断",
  content_action: "内容修改",
  promotion_enrollment: "活动报名",
  safety: "安全保护",
  billing: "积分扣费",
};

function categoryTone(category: string) {
  if (category === "safety") return "red";
  if (category === "billing") return "amber";
  if (category === "competitor_analysis") return "blue";
  if (category === "promotion_enrollment") return "violet";
  return "green";
}

export default function AgentEvaluationsPage() {
  const summary = summarizeAgentEvalCases();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent 评估集"
        description="用固定业务用例检查 Agent 是否真实调用工具、是否生成待审批动作、是否避免危险直接执行。"
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="评估用例" value={summary.total} description="第一版业务回归集" icon={<Activity className="h-4 w-4" />} tone="blue" />
        <MetricCard title="审批保护" value={summary.approvalCases} description="必须等待人工确认" icon={<ShieldCheck className="h-4 w-4" />} tone="green" />
        <MetricCard title="工具覆盖" value={summary.toolCoverage} description="关键 Agent 工具" icon={<Wrench className="h-4 w-4" />} tone="violet" />
        <MetricCard title="场景覆盖" value={summary.categories.length} description="竞品/诊断/活动/安全" icon={<CheckCircle2 className="h-4 w-4" />} tone="amber" />
      </div>

      <Card>
        <SectionHeader title="业务回归用例" description="后续每次改 Agent，都用这组 case 检查是否退化。" />
        <Table head={["场景", "用户输入", "期望工具", "期望动作", "验收标准"]}>
          {agentEvalCases.map((item) => (
            <tr key={item.id} className="align-top hover:bg-gray-50">
              <td className="min-w-[150px] px-4 py-3">
                <Badge tone={categoryTone(item.category)}>{categoryLabels[item.category] ?? item.category}</Badge>
                <div className="mt-2 text-sm font-semibold text-gray-950">{item.title}</div>
                <div className="mt-1 font-mono text-[11px] text-gray-500">{item.id}</div>
              </td>
              <td className="max-w-sm px-4 py-3 text-sm leading-6 text-gray-700">{item.prompt}</td>
              <td className="min-w-[190px] px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {item.expectedTools.map((tool) => (
                    <span key={tool} className="rounded-md bg-blue-50 px-2 py-1 font-mono text-[11px] text-blue-700">
                      {tool}
                    </span>
                  ))}
                </div>
              </td>
              <td className="min-w-[150px] px-4 py-3">
                {item.expectedActions.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {item.expectedActions.map((action) => (
                      <span key={action} className="rounded-md bg-emerald-50 px-2 py-1 font-mono text-[11px] text-emerald-700">
                        {action}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-gray-500">不应创建动作</span>
                )}
                {item.mustWaitForApproval ? (
                  <div className="mt-2 text-xs font-semibold text-amber-700">必须人工确认</div>
                ) : null}
              </td>
              <td className="min-w-[280px] px-4 py-3">
                <ul className="space-y-1 text-xs leading-5 text-gray-600">
                  {item.successCriteria.map((criteria) => (
                    <li key={criteria}>• {criteria}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
