import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  PackageOpen,
  PackageSearch,
  ShoppingCart,
  Store,
  Warehouse,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getOzonAnalyticsView } from "@/lib/ozon-analytics";
import { Badge, Card, EmptyState, MetricCard, PageHeader, ProgressBar, SectionHeader, Table } from "@/components/ui";
import { OzonAnalyticsControls } from "@/components/ozon-analytics-actions";

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatRub(value: string | number | null | undefined) {
  if (value == null) return "暂未获取";
  const amount = Number(value);
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function metricNumber(value: number | null | undefined) {
  return value == null ? "暂未获取" : formatNumber(value);
}

function formatDateTime(value?: string | null) {
  if (!value) return "尚未同步";
  return new Date(value).toLocaleString("zh-CN");
}

function maxOrderCount(items: Array<{ fbs: number; fbo: number }>) {
  return Math.max(1, ...items.map((item) => item.fbs + item.fbo));
}

export default async function AnalyticsPage(
  props: {
    searchParams?: Promise<{ storeId?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="BI 看板" description="管理员账号请进入平台管理。" />;
  }

  const view = await getOzonAnalyticsView({
    tenantId: user.tenantId,
    storeId: searchParams?.storeId,
  });
  const snapshot = view.latestSnapshot;
  const orderMax = maxOrderCount(snapshot?.dailyOrders ?? []);
  const funnelMax = Math.max(1, view.localFunnel.collected);
  const riskyProducts = view.products.filter((product) =>
    product.stock !== null && product.stock <= 5,
  ).slice(0, 20);
  const orderCount = snapshot?.fbsOrderCount != null && snapshot.fboOrderCount != null
    ? snapshot.fbsOrderCount + snapshot.fboOrderCount
    : null;
  const orderCoverage = snapshot?.orderDataStatus.state === "partial"
    ? "订单数据仅覆盖读取成功的渠道"
    : snapshot?.orderDataStatus.state === "unavailable" || snapshot?.orderDataStatus.state === "unknown"
      ? "订单数据暂未获取"
      : "平台回款优先，缺失时使用订单售价";

  return (
    <div className="space-y-6">
      <PageHeader
        title="BI 看板"
        description="看 Ozon 销售、库存风险和本系统上架转化。"
      >
        <OzonAnalyticsControls storeId={view.store?.id ?? null} stores={view.stores} />
      </PageHeader>

      {view.stores.length === 0 ? (
        <EmptyState title="还没有 Ozon 店铺" description="先连接 Ozon 店铺，数据看板才能读取商品、库存和订单数据。">
          <Link
            href="/stores"
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#3478f6] px-3 text-sm font-medium text-white shadow-[0_8px_20px_rgba(52,120,246,0.18)] hover:bg-[#2868df]"
          >
            <Store className="h-4 w-4" aria-hidden="true" />
            连接 Ozon 店铺
          </Link>
        </EmptyState>
      ) : null}

      {view.stores.length > 0 && !snapshot ? (
        <Card className="border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-medium text-blue-950">还没有同步过 Ozon 数据</div>
              <div className="mt-1 text-sm text-blue-800">点击右上角刷新按钮后，这里会显示店铺商品、库存和近 7 天订单。</div>
            </div>
            <Badge tone="blue">{view.store?.name ?? "Ozon 店铺"}</Badge>
          </div>
        </Card>
      ) : null}

      {snapshot?.error ? (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <div className="font-medium text-amber-950">最近一次同步有错误</div>
              <div className="mt-1 text-sm text-amber-800">{snapshot.error}</div>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Ozon 商品" value={formatNumber(snapshot?.productCount ?? 0)} description={`最后同步：${formatDateTime(snapshot?.syncedAt)}`} icon={<Boxes className="h-4 w-4" />} tone="blue" />
        <MetricCard title="可售商品" value={metricNumber(snapshot?.visibleProductCount)} description={`已归档：${formatNumber(snapshot?.archivedProductCount ?? 0)}`} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
        <MetricCard title="总库存" value={metricNumber(snapshot?.totalStock)} description={`低库存：${metricNumber(snapshot?.lowStockCount)}`} icon={<Warehouse className="h-4 w-4" />} tone={(snapshot?.lowStockCount ?? 0) > 0 ? "amber" : "gray"} />
        <MetricCard title="近 7 天订单金额" value={formatRub(snapshot?.grossRevenueRub)} description={orderCount === null ? orderCoverage : `${formatNumber(orderCount)} 个订单 · ${orderCoverage}`} icon={<CircleDollarSign className="h-4 w-4" />} tone="violet" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="FBS 订单" value={metricNumber(snapshot?.fbsOrderCount)} description="近 7 天自配送订单" icon={<ShoppingCart className="h-4 w-4" />} tone="blue" />
        <MetricCard title="FBO 订单" value={metricNumber(snapshot?.fboOrderCount)} description="近 7 天平台仓订单" icon={<PackageOpen className="h-4 w-4" />} tone="green" />
        <MetricCard title="待处理订单" value={metricNumber(snapshot?.pendingShipmentCount)} description={`取消/异常：${metricNumber(snapshot?.cancelledOrderCount)}`} icon={<AlertTriangle className="h-4 w-4" />} tone={(snapshot?.pendingShipmentCount ?? 0) > 0 ? "amber" : "gray"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeader title="近 7 天订单趋势" description={`按 Ozon FBS / FBO 订单创建时间统计。${orderCoverage}`} />
          {snapshot?.orderDataStatus.state === "complete" && snapshot.dailyOrders.length ? (
            <div className="space-y-3">
              {snapshot.dailyOrders.map((item) => {
                const total = item.fbs + item.fbo;
                return (
                  <div key={item.date} className="grid grid-cols-[88px_minmax(0,1fr)_56px] items-center gap-3 text-sm">
                    <div className="text-gray-500">{item.date.slice(5)}</div>
                    <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full bg-[#3478f6]" style={{ width: `${(total / orderMax) * 100}%` }} />
                    </div>
                    <div className="text-right font-medium text-gray-900">{total}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={snapshot?.orderDataStatus.state === "complete" ? "本期没有订单" : "订单趋势暂未获取"}
              description={snapshot?.orderDataStatus.state === "complete" ? "当前周期没有订单记录。" : orderCoverage}
            />
          )}
        </Card>

        <Card>
          <SectionHeader title="本系统上架漏斗" description="从 1688 采集到 Ozon 提交的内部进度。" />
          {[
            { label: "已采集商品", value: view.localFunnel.collected, icon: PackageSearch },
            { label: "商品池", value: view.localFunnel.productPool, icon: Boxes },
            { label: "Ozon 草稿", value: view.localFunnel.drafts, icon: BarChart3 },
            { label: "待发布草稿", value: view.localFunnel.compiledDrafts, icon: CheckCircle2 },
            { label: "已提交记录", value: view.localFunnel.submittedRuns, icon: ShoppingCart },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="mb-4 last:mb-0">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <Icon className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    {item.label}
                  </div>
                  <div className="text-sm font-semibold text-gray-950">{formatNumber(item.value)}</div>
                </div>
                <ProgressBar value={(item.value / funnelMax) * 100} />
              </div>
            );
          })}
        </Card>
      </div>

      <Card>
        <SectionHeader
          title={snapshot?.orderDataStatus.state === "partial" ? "读取成功渠道的近 7 天订单商品" : "近 7 天订单商品"}
          description={`按 Ozon 订单商品件数排序。${orderCoverage}`}
        />
        {snapshot?.topProducts.length ? (
          <Table head={["商品", "订单件数", "订单金额"]}>
            {snapshot.topProducts.map((product) => (
              <tr key={product.offerId} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="min-w-[280px]">
                    <div className="line-clamp-2 font-medium text-gray-950">{product.name ?? product.offerId}</div>
                    <div className="text-xs text-gray-500">{product.offerId}</div>
                  </div>
                </td>
                <td className="px-4 py-3 font-semibold text-gray-950">{formatNumber(product.quantity)}</td>
                <td className="px-4 py-3">{formatRub(product.revenueRub)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState
            title={snapshot?.orderDataStatus.state === "complete" ? "本期没有订单商品" : "订单商品暂未获取"}
            description={snapshot?.orderDataStatus.state === "complete" ? "当前周期没有订单商品记录。" : orderCoverage}
          />
        )}
      </Card>

      <Card>
        <SectionHeader title="库存风险商品" description="库存小于等于 5 的 Ozon 商品，优先补货或下架处理。" />
        {riskyProducts.length === 0 ? (
          <EmptyState title="暂无库存风险" description="没有低库存商品，或还没有同步商品库存。" />
        ) : (
          <Table head={["商品", "状态", "库存", "预留", "价格"]}>
            {riskyProducts.map((product) => (
              <tr key={product.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex min-w-[280px] items-center gap-3">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt="" className="h-14 w-14 rounded-xl border border-[#e1eaf4] bg-white object-contain" />
                    ) : (
                      <div className="h-12 w-12 rounded-xl bg-[#f2f6fb]" />
                    )}
                    <div className="min-w-0">
                      <div className="line-clamp-2 font-medium text-gray-950">{product.name ?? product.offerId}</div>
                      <div className="text-xs text-gray-500">{product.offerId}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={product.visible && !product.archived ? "green" : "gray"}>
                    {product.archived
                      ? "已归档"
                      : product.status ?? (product.visible === null ? "状态未知" : product.visible ? "可售" : "不可售")}
                  </Badge>
                </td>
                <td className="px-4 py-3 font-semibold text-gray-950">{product.stock === null ? "未知" : formatNumber(product.stock)}</td>
                <td className="px-4 py-3 text-gray-600">{product.reservedStock === null ? "未知" : formatNumber(product.reservedStock)}</td>
                <td className="px-4 py-3">{product.priceRub ? formatRub(product.priceRub) : "-"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
