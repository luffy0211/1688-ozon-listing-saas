import { prisma } from "@saas/db";
import { AdminTenantCreator } from "@/components/admin-tenant-creator";
import { EmptyState, MetricCard, PageHeader, Table } from "@/components/ui";

export default async function AdminTenantsPage() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          users: true,
          stores: true,
          sourceProducts: true,
          listingJobs: true,
        },
      },
    },
  });

  const users = tenants.reduce((sum, tenant) => sum + tenant._count.users, 0);
  const products = tenants.reduce((sum, tenant) => sum + tenant._count.sourceProducts, 0);
  const jobs = tenants.reduce((sum, tenant) => sum + tenant._count.listingJobs, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="租户管理" description="查看租户、用户、店铺、商品和任务数量。" />
      <AdminTenantCreator />
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="租户" value={tenants.length} />
        <MetricCard title="用户" value={users} />
        <MetricCard title="商品" value={products} />
        <MetricCard title="任务" value={jobs} />
      </div>
      {tenants.length === 0 ? (
        <EmptyState title="暂无租户" />
      ) : (
        <Table head={["租户", "用户", "Ozon 店铺", "商品", "任务", "创建时间"]}>
          {tenants.map((tenant) => (
            <tr key={tenant.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-950">{tenant.name}</td>
              <td className="px-4 py-3">{tenant._count.users}</td>
              <td className="px-4 py-3">{tenant._count.stores}</td>
              <td className="px-4 py-3">{tenant._count.sourceProducts}</td>
              <td className="px-4 py-3">{tenant._count.listingJobs}</td>
              <td className="px-4 py-3 text-gray-500">{tenant.createdAt.toLocaleString("zh-CN")}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
