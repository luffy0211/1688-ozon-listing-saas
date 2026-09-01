import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { prisma, type ShopFollowStatus } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Card, MetricCard, PageHeader, SectionHeader, Table, cn } from "@/components/ui";
import {
  ShopSnapshotActions,
  type ShopSnapshotView,
} from "@/components/api-actions";
import { StatusBadge } from "@/components/status";

const statusTabs: Array<{ value: ShopFollowStatus | "ALL"; label: string }> = [
  { value: "NEW", label: "待选品" },
  { value: "IMPORTED_TO_PRODUCT_POOL", label: "已入池" },
  { value: "IGNORED", label: "已忽略" },
  { value: "KNOWN", label: "已采集" },
  { value: "NOT_SEEN_IN_LATEST_SYNC", label: "本次未出现" },
  { value: "ALL", label: "全部" },
];

function normalizeStatus(value: string | undefined): ShopFollowStatus | "ALL" {
  if (value === "ALL") return "ALL";
  return statusTabs.some((tab) => tab.value === value && value !== "ALL")
    ? (value as ShopFollowStatus)
    : "NEW";
}

export default async function ShopDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { status?: string };
}) {
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="选品列表" description="管理员账号请进入平台管理。" />;
  }

  const activeStatus = normalizeStatus(searchParams?.status);
  const snapshotWhere =
    activeStatus === "ALL"
      ? { tenantId: user.tenantId, shopId: params.id }
      : { tenantId: user.tenantId, shopId: params.id, followStatus: activeStatus };

  const [shop, snapshots, counts] = await Promise.all([
    prisma.sourceShop.findFirst({
      where: { tenantId: user.tenantId, id: params.id },
      include: {
        syncRuns: { orderBy: { startedAt: "desc" }, take: 10 },
        supplier: true,
      },
    }),
    prisma.shopProductSnapshot.findMany({
      where: snapshotWhere,
      orderBy: [{ followStatus: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.shopProductSnapshot.groupBy({
      by: ["followStatus"],
      where: { tenantId: user.tenantId, shopId: params.id },
      _count: { _all: true },
    }),
  ]);
  if (!shop) return <PageHeader title="店铺不存在" />;

  const countMap = new Map(counts.map((item) => [item.followStatus, item._count._all]));
  const totalSnapshots = counts.reduce((sum, item) => sum + item._count._all, 0);
  const snapshotViews: ShopSnapshotView[] = snapshots.map((item) => ({
    id: item.id,
    offerId: item.offerId,
    title: item.title ?? "",
    url: item.url,
    imageUrl: item.imageUrl,
    priceText: item.priceText,
    followStatus: item.followStatus,
    firstSeenAt: item.firstSeenAt.toISOString(),
    lastSeenAt: item.lastSeenAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="选品列表" description={shop.shopName}>
        <Link href="/shops" className="inline-flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
          返回采集选品
        </Link>
        {shop.shopUrl ? (
          <a className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50" href={shop.shopUrl} target="_blank">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            打开 1688 店铺
          </a>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="商品快照" value={totalSnapshots} description="按 Offer ID 去重" />
        <MetricCard title="待选品" value={countMap.get("NEW") ?? 0} description="可以导入商品池" tone="blue" />
        <MetricCard title="已入池" value={countMap.get("IMPORTED_TO_PRODUCT_POOL") ?? 0} tone="green" />
        <MetricCard title="最近采集" value={shop.lastSeenAt ? shop.lastSeenAt.toLocaleDateString("zh-CN") : "-"} description={shop.syncRuns[0]?.status ?? "暂无记录"} />
      </div>

      <Card>
        <SectionHeader title="店铺资料" />
        <div className="grid gap-3 text-sm md:grid-cols-4">
          <div><span className="text-gray-500">旺旺：</span>{shop.wangwang ?? "-"}</div>
          <div><span className="text-gray-500">联系人：</span>{shop.contactName ?? "-"}</div>
          <div><span className="text-gray-500">电话：</span>{shop.phone ?? "-"}</div>
          <div><span className="text-gray-500">地区：</span>{shop.location ?? "-"}</div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {statusTabs.map((tab) => {
          const count = tab.value === "ALL" ? totalSnapshots : countMap.get(tab.value) ?? 0;
          const active = tab.value === activeStatus;
          return (
            <Link
              key={tab.value}
              href={`/shops/${shop.id}?status=${tab.value}`}
              className={cn(
                "inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium",
                active ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
              )}
            >
              {tab.label}
              <span className="ml-2 text-xs text-gray-500">{count}</span>
            </Link>
          );
        })}
      </div>

      <Card>
        <SectionHeader title="选择要上架的商品" description="勾选商品后导入商品池，后续在商品池批量生成 Ozon 草稿。" />
        <ShopSnapshotActions shopId={shop.id} snapshots={snapshotViews} />
      </Card>

      <Card>
        <SectionHeader title="采集历史" />
        <Table head={["时间", "总数", "新品", "状态", "错误"]}>
          {shop.syncRuns.map((run) => (
            <tr key={run.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">{run.startedAt.toLocaleString("zh-CN")}</td>
              <td className="px-4 py-3">{run.totalCount}</td>
              <td className="px-4 py-3">{run.newCount}</td>
              <td className="px-4 py-3"><StatusBadge status={run.status.toUpperCase()} /></td>
              <td className="px-4 py-3 text-red-700">{run.error ?? "-"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
