import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, EmptyState, MetricCard, PageHeader, Table } from "@/components/ui";

const cooperationLabels: Record<string, string> = {
  UNCONTACTED: "未联系",
  CONTACTED: "已联系",
  SAMPLING: "打样中",
  COOPERATING: "合作中",
  NOT_COOPERATING: "不合作",
};

export default async function SuppliersPage() {
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="供应商" description="管理员账号请进入平台管理。" />;
  }

  const suppliers = await prisma.supplier.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { updatedAt: "desc" },
    include: { sourceShops: true },
  });

  const cooperating = suppliers.filter((supplier) => supplier.cooperationStatus === "COOPERATING").length;
  const uncontacted = suppliers.filter((supplier) => supplier.cooperationStatus === "UNCONTACTED").length;

  return (
    <div className="space-y-6">
      <PageHeader title="供应商" description="查看已采集店铺对应的供应商资料，便于后续供货跟进。" />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="供应商" value={suppliers.length} description="由 1688 店铺资料沉淀" />
        <MetricCard title="未联系" value={uncontacted} tone={uncontacted > 0 ? "amber" : "gray"} />
        <MetricCard title="合作中" value={cooperating} tone="green" />
      </div>
      {suppliers.length === 0 ? (
        <EmptyState title="暂无供应商" description="采集店铺后，供应商资料会沉淀到这里。" />
      ) : (
        <Table head={["供应商", "店铺", "联系人", "电话", "状态", "下次跟进"]}>
          {suppliers.map((supplier) => (
            <tr key={supplier.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="font-medium text-gray-950">{supplier.name}</div>
                <div className="text-xs text-gray-500">{supplier.companyName ?? "-"}</div>
              </td>
              <td className="max-w-sm px-4 py-3">{supplier.sourceShops.map((shop) => shop.shopName).join(", ") || "-"}</td>
              <td className="px-4 py-3">{supplier.contactName ?? supplier.wangwang ?? "-"}</td>
              <td className="px-4 py-3">{supplier.phone ?? "-"}</td>
              <td className="px-4 py-3"><Badge>{cooperationLabels[supplier.cooperationStatus] ?? supplier.cooperationStatus}</Badge></td>
              <td className="px-4 py-3">{supplier.nextFollowUpAt?.toLocaleDateString("zh-CN") ?? "-"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
