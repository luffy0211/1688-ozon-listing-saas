import Link from "next/link";
import { ArrowRight, Store } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, EmptyState, MetricCard, PageHeader, SectionHeader, Table } from "@/components/ui";
import {
  ShopImportForm,
  type Source1688CredentialView,
} from "@/components/api-actions";

export default async function ShopsPage() {
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="采集选品" description="管理员账号请进入平台管理。" />;
  }

  const [shops, credentials, shopCount, newSnapshotCount, importedSnapshotCount] = await Promise.all([
    prisma.sourceShop.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { sourceProducts: true, snapshots: true } },
        snapshots: { where: { followStatus: "NEW" }, select: { id: true } },
      },
    }),
    prisma.source1688Credential.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sourceShop.count({ where: { tenantId: user.tenantId } }),
    prisma.shopProductSnapshot.count({ where: { tenantId: user.tenantId, followStatus: "NEW" } }),
    prisma.shopProductSnapshot.count({ where: { tenantId: user.tenantId, followStatus: "IMPORTED_TO_PRODUCT_POOL" } }),
  ]);

  const credentialViews: Source1688CredentialView[] = credentials.map((cred) => ({
    id: cred.id,
    name: cred.name,
    status: cred.status,
    lastVerifiedAt: cred.lastVerifiedAt?.toISOString() ?? null,
    createdAt: cred.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="采集选品"
        description="输入 1688 店铺链接采集新品，再进入店铺详情勾选要上架的商品。"
      />

      {credentialViews.length === 0 ? (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-medium text-amber-950">还没有 1688 登录信息</div>
              <div className="mt-1 text-sm text-amber-800">先在设置中保存 Cookie，再回来采集店铺商品。</div>
            </div>
            <Link className="inline-flex h-9 items-center rounded-md bg-amber-600 px-3 text-sm font-medium text-white hover:bg-amber-700" href="/1688-credentials">
              去设置
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="已采集店铺" value={shopCount} icon={<Store className="h-4 w-4" />} />
        <MetricCard title="待选新品" value={newSnapshotCount} description="进入店铺详情勾选" tone="blue" />
        <MetricCard title="已入商品池" value={importedSnapshotCount} description="已进入后续草稿流程" tone="green" />
      </div>

      <Card>
        <SectionHeader title="采集店铺商品" description="建议每次先采集 50 到 200 个最新商品，再人工筛选。" />
        <ShopImportForm credentials={credentialViews} />
      </Card>

      {shops.length === 0 ? (
        <EmptyState title="还没有采集过店铺" description="输入一个 1688 店铺链接后，采集结果会出现在这里。" />
      ) : (
        <Table head={["店铺", "商品快照", "待选", "已入池", "最后采集", "下一步"]}>
          {shops.map((shop) => (
            <tr key={shop.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <Link className="font-medium text-gray-950 hover:text-blue-700" href={`/shops/${shop.id}`}>
                  {shop.shopName}
                </Link>
                <div className="mt-1 text-xs text-gray-500">{shop.shopUrl ?? "-"}</div>
              </td>
              <td className="px-4 py-3">{shop._count.snapshots}</td>
              <td className="px-4 py-3">
                <Badge tone={shop.snapshots.length > 0 ? "blue" : "gray"}>{shop.snapshots.length}</Badge>
              </td>
              <td className="px-4 py-3">{shop._count.sourceProducts}</td>
              <td className="px-4 py-3 text-gray-500">
                {shop.lastSeenAt?.toLocaleString("zh-CN") ?? "-"}
              </td>
              <td className="px-4 py-3">
                <Link href={`/shops/${shop.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
                  进入选品
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
