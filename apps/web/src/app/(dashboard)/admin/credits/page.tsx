import { Coins, History, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getAdminCreditOverview } from "@/lib/credits";
import { AdminCreditAdjuster } from "@/components/admin-credit-adjuster";
import { Badge, EmptyState, MetricCard, PageHeader, Table } from "@/components/ui";

const typeLabels = {
  ADMIN_GRANT: "管理员加积分",
  ADMIN_DEDUCT: "管理员扣积分",
  USAGE_DEBIT: "功能扣费",
  USAGE_REFUND: "扣费退回",
  PAYMENT_CREDIT: "支付入账",
} as const;

function formatDelta(delta: number) {
  return delta > 0 ? `+${delta}` : String(delta);
}

export default async function AdminCreditsPage() {
  await requireAdmin();
  const { tenants, transactions } = await getAdminCreditOverview();
  const tenantRows = tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    balance: tenant.creditAccount?.balance ?? 0,
    users: tenant._count.users,
    products: tenant._count.sourceProducts,
    jobs: tenant._count.listingJobs,
  }));
  const totalCredits = tenantRows.reduce((sum, tenant) => sum + tenant.balance, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="积分管理"
        description="管理员手动给租户加积分、扣积分，并查看每次调整后的余额流水。"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="租户数量" value={tenantRows.length} icon={<Users className="h-4 w-4" aria-hidden="true" />} />
        <MetricCard title="总余额" value={totalCredits} tone="green" icon={<Coins className="h-4 w-4" aria-hidden="true" />} />
        <MetricCard title="流水记录" value={transactions.length} tone="violet" icon={<History className="h-4 w-4" aria-hidden="true" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <AdminCreditAdjuster tenants={tenantRows.map((tenant) => ({
          id: tenant.id,
          name: tenant.name,
          balance: tenant.balance,
        }))} />

        {tenantRows.length === 0 ? (
          <EmptyState title="暂无租户" description="有租户注册后，管理员可以在这里配置积分。" />
        ) : (
          <Table head={["租户", "余额", "用户", "商品", "任务"]}>
            {tenantRows.map((tenant) => (
              <tr key={tenant.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-950">{tenant.name}</td>
                <td className="px-4 py-3">
                  <Badge tone={tenant.balance > 0 ? "green" : "gray"}>{tenant.balance}</Badge>
                </td>
                <td className="px-4 py-3">{tenant.users}</td>
                <td className="px-4 py-3">{tenant.products}</td>
                <td className="px-4 py-3">{tenant.jobs}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {transactions.length === 0 ? (
        <EmptyState title="暂无积分流水" description="管理员加减积分后，这里会显示完整记录。" />
      ) : (
        <Table head={["时间", "租户", "类型", "变动", "操作后余额", "原因"]}>
          {transactions.map((transaction) => (
            <tr key={transaction.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-500">{transaction.createdAt.toLocaleString("zh-CN")}</td>
              <td className="px-4 py-3 font-medium text-gray-950">{transaction.tenant.name}</td>
              <td className="px-4 py-3">{typeLabels[transaction.type]}</td>
              <td className={transaction.delta > 0 ? "px-4 py-3 font-semibold text-emerald-700" : "px-4 py-3 font-semibold text-red-700"}>
                {formatDelta(transaction.delta)}
              </td>
              <td className="px-4 py-3">{transaction.balanceAfter}</td>
              <td className="max-w-sm truncate px-4 py-3 text-gray-500">{transaction.reason ?? "-"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
