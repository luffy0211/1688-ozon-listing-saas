import Link from "next/link";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, EmptyState, PageHeader, SectionHeader, Table } from "@/components/ui";
import { PricingRuleForm } from "@/components/api-actions";

export default async function PricingRulesPage() {
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="定价规则" description="管理员账号请进入平台管理。" />;
  }

  const rules = await prisma.pricingRule.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="定价规则" description="配置采购、物流、佣金和毛利，用于计算 Ozon 售价。">
        <Link href="/settings" className="inline-flex h-9 items-center rounded-xl border border-[#d8e4f2] bg-white px-3 text-sm font-medium text-gray-700 hover:bg-[#f7faff]">
          返回配置中心
        </Link>
      </PageHeader>
      <Card>
        <SectionHeader title="新增定价规则" description="第一版使用手动汇率和固定规则，不接自动汇率 API。" />
        <PricingRuleForm />
      </Card>
      {rules.length === 0 ? (
        <EmptyState title="暂无定价规则" description="至少配置一个默认规则，才能生成 Ozon 草稿价格。" />
      ) : (
        <Table head={["规则", "国内运费", "包材", "汇率", "国际物流", "佣金", "毛利", "默认"]}>
          {rules.map((rule) => (
            <tr key={rule.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-950">{rule.name}</td>
              <td className="px-4 py-3">{String(rule.domesticShippingCny)}</td>
              <td className="px-4 py-3">{String(rule.packagingCny)}</td>
              <td className="px-4 py-3">{String(rule.cnyToRub)}</td>
              <td className="px-4 py-3">{String(rule.internationalShippingRub)}</td>
              <td className="px-4 py-3">{String(rule.commissionRate)}</td>
              <td className="px-4 py-3">{String(rule.targetMarginRate)}</td>
              <td className="px-4 py-3">{rule.isDefault ? <Badge tone="green">默认</Badge> : "-"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
