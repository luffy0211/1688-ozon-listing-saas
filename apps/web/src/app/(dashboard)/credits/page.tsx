import { Coins, History, ReceiptText, TrendingDown } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { getCreditFeatureCatalog } from "@/lib/credits";
import { Badge, Card, EmptyState, MetricCard, PageHeader, SectionHeader, Table } from "@/components/ui";

function formatDate(value: Date) {
  return value.toLocaleString("zh-CN");
}

function typeTone(type: string): "gray" | "green" | "red" | "amber" | "blue" | "violet" {
  if (type.includes("GRANT") || type.includes("REFUND") || type.includes("PAYMENT")) return "green";
  if (type.includes("DEDUCT") || type.includes("DEBIT")) return "red";
  return "gray";
}

export default async function CreditsPage() {
  const user = await requireUser();
  const tenantId = user.tenantId;
  if (!tenantId) return <PageHeader title="积分流水" description="平台管理员请进入积分管理。" />;

  const [account, transactions, usageCount] = await Promise.all([
    prisma.creditAccount.findUnique({ where: { tenantId } }),
    prisma.creditTransaction.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.creditTransaction.count({ where: { tenantId, type: "USAGE_DEBIT" } }),
  ]);
  const features = getCreditFeatureCatalog();
  const totalDebit = transactions
    .filter((item) => item.delta < 0)
    .reduce((sum, item) => sum + Math.abs(item.delta), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="积分流水"
        description="查看当前租户积分余额、功能价格和最近扣费/退费记录。"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="当前余额" value={account?.balance ?? 0} description="余额不足时付费功能会被拦截" icon={<Coins className="h-4 w-4" />} tone="blue" />
        <MetricCard title="最近消耗" value={totalDebit} description="最近 100 条流水中的扣减总量" icon={<TrendingDown className="h-4 w-4" />} tone={totalDebit ? "amber" : "gray"} />
        <MetricCard title="使用次数" value={usageCount} description="功能扣费记录数量" icon={<ReceiptText className="h-4 w-4" />} tone="violet" />
      </div>

      <Card>
        <SectionHeader title="功能价格" description="当前为本地配置价格，后续可以改成后台可配置。" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {features.map((feature) => (
            <div key={feature.key} className="rounded-2xl border border-[#e3ebf5] bg-white p-4">
              <div className="text-sm font-semibold text-gray-950">{feature.label}</div>
              <div className="mt-2 text-2xl font-bold text-[#17223d]">{feature.cost}</div>
              <div className="mt-1 text-xs text-gray-500">积分/次</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionHeader title="最近流水" description="扣费、管理员加减积分、失败退回都会记录在这里。" />
        {transactions.length === 0 ? (
          <EmptyState title="暂无积分流水" description="管理员加积分或使用付费功能后会出现记录。" />
        ) : (
          <Table head={["时间", "类型", "变化", "余额", "原因", "业务引用"]}>
            {transactions.map((tx) => (
              <tr key={tx.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">{formatDate(tx.createdAt)}</td>
                <td className="px-4 py-3"><Badge tone={typeTone(tx.type)}>{tx.type}</Badge></td>
                <td className={tx.delta >= 0 ? "px-4 py-3 font-semibold text-emerald-700" : "px-4 py-3 font-semibold text-red-700"}>
                  {tx.delta >= 0 ? `+${tx.delta}` : tx.delta}
                </td>
                <td className="px-4 py-3">{tx.balanceAfter}</td>
                <td className="max-w-sm truncate px-4 py-3">{tx.reason ?? "-"}</td>
                <td className="max-w-sm truncate px-4 py-3 font-mono text-xs text-gray-500">
                  {[tx.referenceType, tx.referenceId].filter(Boolean).join(" / ") || "-"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="border-blue-200 bg-blue-50">
        <div className="flex items-start gap-3">
          <History className="mt-0.5 h-5 w-5 text-blue-700" />
          <div>
            <div className="font-semibold text-blue-950">扣费规则说明</div>
            <p className="mt-1 text-sm leading-6 text-blue-800">
              Agent 对话、店铺诊断、竞品分析、上架发布和 Ozon 执行动作都会扣积分；失败路径会尽量自动退回，重复请求通过幂等键避免重复扣费。
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
