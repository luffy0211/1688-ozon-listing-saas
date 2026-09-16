import Link from "next/link";
import { CheckCircle2, Circle, Coins, Store, WandSparkles } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, MetricCard, PageHeader, ProgressBar, Table } from "@/components/ui";

type Step = {
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
};

export default async function GettingStartedPage() {
  const user = await requireUser();
  const tenantId = user.tenantId;
  if (!tenantId) return <PageHeader title="开始使用" description="平台管理员账号无需上架配置。" />;

  const [
    storeCount,
    source1688Count,
    xiangjiCount,
    pricingRuleCount,
    creditAccount,
    productCount,
    submittedCount,
    pendingActionCount,
  ] = await Promise.all([
    prisma.store.count({ where: { tenantId } }),
    prisma.source1688Credential.count({ where: { tenantId } }),
    prisma.xiangjiCredential.count({ where: { tenantId } }),
    prisma.pricingRule.count({ where: { tenantId } }),
    prisma.creditAccount.findUnique({ where: { tenantId }, select: { balance: true } }),
    prisma.sourceProduct.count({ where: { tenantId } }),
    prisma.publishRun.count({ where: { tenantId, status: "submitted" } }),
    prisma.agentAction.count({ where: { tenantId, status: "PENDING_APPROVAL" } }),
  ]);

  const steps: Step[] = [
    {
      title: "配置 Ozon 店铺",
      description: "保存 Ozon Seller API Client ID 和 API Key，后续上架、诊断和活动报名都依赖它。",
      href: "/stores",
      cta: "配置店铺",
      done: storeCount > 0,
    },
    {
      title: "配置 1688 登录态",
      description: "用于接口采集 1688 商品和店铺数据；如果你先导入 JSON，也可以后补。",
      href: "/1688-credentials",
      cta: "配置登录态",
      done: source1688Count > 0,
    },
    {
      title: "配置翻译和定价",
      description: "象寄负责图片/文本辅助，定价规则决定 Ozon 上架价格。",
      href: "/settings",
      cta: "检查设置",
      done: xiangjiCount > 0 && pricingRuleCount > 0,
    },
    {
      title: "给账号加积分",
      description: "Agent 对话、竞品分析、店铺诊断、上架和执行动作都会消耗积分。",
      href: user.role === "admin" ? "/admin/credits" : "/credits",
      cta: user.role === "admin" ? "积分管理" : "查看积分",
      done: (creditAccount?.balance ?? 0) > 0,
    },
    {
      title: "采集商品并开始上架",
      description: "导入商品后进入自动化工作流，选择商品即可生成资料并提交。",
      href: productCount > 0 ? "/workflow" : "/shops",
      cta: productCount > 0 ? "进入工作流" : "采集商品",
      done: productCount > 0,
    },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const progress = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="space-y-6">
      <PageHeader
        title="开始使用"
        description="按顺序完成配置后，运营人员就可以从采集、体检、上架、诊断、竞品分析到审批执行完整跑起来。"
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="完成度" value={`${progress}%`} description={`${doneCount} / ${steps.length} 项已完成`} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
        <MetricCard title="积分余额" value={creditAccount?.balance ?? 0} description="低于功能消耗时会被拦截" icon={<Coins className="h-4 w-4" />} tone="blue" />
        <MetricCard title="商品池" value={productCount} description="已采集或导入商品" icon={<Store className="h-4 w-4" />} tone="violet" />
        <MetricCard title="待审批" value={pendingActionCount} description="Agent 生成、等待确认的动作" icon={<WandSparkles className="h-4 w-4" />} tone={pendingActionCount ? "amber" : "gray"} />
      </div>

      <Card>
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-[#52627b]">
            <span>初始化进度</span>
            <span>{progress}%</span>
          </div>
          <ProgressBar value={progress} />
        </div>
        <Table head={["状态", "步骤", "说明", "操作"]}>
          {steps.map((step) => (
            <tr key={step.title} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                {step.done ? (
                  <Badge tone="green"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />已完成</Badge>
                ) : (
                  <Badge tone="amber"><Circle className="mr-1 h-3.5 w-3.5" />待处理</Badge>
                )}
              </td>
              <td className="px-4 py-3 font-semibold text-gray-950">{step.title}</td>
              <td className="max-w-2xl px-4 py-3 text-gray-600">{step.description}</td>
              <td className="px-4 py-3">
                <Link className="inline-flex h-9 items-center rounded-xl bg-[#3478f6] px-3 text-sm font-semibold text-white hover:bg-[#2868df]" href={step.href}>
                  {step.cta}
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {submittedCount > 0 ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <div className="font-semibold text-emerald-950">已经跑通过上架闭环</div>
          <p className="mt-1 text-sm text-emerald-800">当前租户已有 {submittedCount} 条提交记录，可以继续通过任务中心和 BI 看板观察结果。</p>
        </Card>
      ) : null}
    </div>
  );
}
