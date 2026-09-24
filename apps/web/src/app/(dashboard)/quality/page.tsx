import Link from "next/link";
import { AlertTriangle, CheckCircle2, ImageOff, PackageSearch } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { preferredProductImageUrl } from "@/lib/product-image";
import { Badge, Card, EmptyState, MetricCard, PageHeader, SectionHeader, Table } from "@/components/ui";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function attributeCount(value: unknown) {
  const data = asRecord(value);
  const attributes = data.attributes ?? data.productAttributes ?? data.ozonAttributes;
  return Array.isArray(attributes) ? attributes.length : 0;
}

function detectIssues(product: {
  title: string | null;
  productAssets: Array<{ kind: string; publicUrl: string | null; sourceUrl: string | null }>;
  productFacts: Array<{ normalizedJson: unknown }>;
  listingJobs: Array<{ status: string; error: string | null }>;
  ozonDrafts: Array<{ status: string; priceRub: unknown; payloadJson: unknown; error: string | null }>;
}) {
  const issues: Array<{ label: string; tone: "red" | "amber" | "gray" }> = [];
  const imageUrl = preferredProductImageUrl(product.productAssets);
  const latestFact = product.productFacts[0];
  const latestDraft = product.ozonDrafts[0];
  const latestJob = product.listingJobs[0];
  const title = product.title ?? "";

  if (!imageUrl) issues.push({ label: "缺少主图", tone: "red" });
  if (/大图|轮播|视频|详情|undefined|null/i.test(title)) {
    issues.push({ label: "标题疑似脏数据", tone: "red" });
  }
  if (!latestFact) issues.push({ label: "缺少商品事实", tone: "amber" });
  if (latestFact && attributeCount(latestFact.normalizedJson) === 0) {
    issues.push({ label: "属性不足", tone: "amber" });
  }
  if (!latestDraft) issues.push({ label: "未生成 Ozon 资料", tone: "amber" });
  if (latestDraft && !latestDraft.priceRub) issues.push({ label: "缺少价格", tone: "red" });
  if (latestDraft?.error) issues.push({ label: "草稿异常", tone: "red" });
  if (latestJob?.status === "FAILED") issues.push({ label: "上架任务失败", tone: "red" });
  return issues;
}

export default async function QualityPage() {
  const user = await requireUser();
  const tenantId = user.tenantId;
  if (!tenantId) return <PageHeader title="商品体检" description="平台管理员没有商品池。" />;

  const products = await prisma.sourceProduct.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    take: 80,
    include: {
      productAssets: { orderBy: [{ sortOrder: "asc" }] },
      productFacts: { orderBy: { updatedAt: "desc" }, take: 1 },
      ozonDrafts: { orderBy: { updatedAt: "desc" }, take: 1 },
      listingJobs: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });

  const rows = products.map((product) => ({
    product,
    imageUrl: preferredProductImageUrl(product.productAssets),
    issues: detectIssues(product),
  }));
  const issueRows = rows.filter((row) => row.issues.length > 0);
  const criticalCount = rows.filter((row) => row.issues.some((issue) => issue.tone === "red")).length;
  const readyCount = rows.length - issueRows.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="商品体检"
        description="上架前先检查商品资料质量；红色问题建议先修复，黄色问题可以根据商品情况判断。"
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="检查商品" value={products.length} description="最近更新的 80 个商品" icon={<PackageSearch className="h-4 w-4" />} tone="blue" />
        <MetricCard title="可直接推进" value={readyCount} description="未发现明显问题" icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
        <MetricCard title="需处理" value={issueRows.length} description="存在红/黄问题" icon={<AlertTriangle className="h-4 w-4" />} tone={issueRows.length ? "amber" : "gray"} />
        <MetricCard title="高风险" value={criticalCount} description="缺图、脏标题、价格或任务失败" icon={<ImageOff className="h-4 w-4" />} tone={criticalCount ? "red" : "gray"} />
      </div>

      <Card>
        <SectionHeader title="问题商品" description="点击商品详情处理图片、标题、草稿和任务失败问题。" />
        {issueRows.length === 0 ? (
          <EmptyState title="暂未发现明显问题" description="后续可以继续增加类目、属性和图片质量规则。" />
        ) : (
          <Table head={["商品", "当前状态", "问题", "建议操作"]}>
            {issueRows.map(({ product, imageUrl, issues }) => (
              <tr key={product.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex min-w-[300px] items-center gap-3">
                    {imageUrl ? <img src={imageUrl} alt="" className="h-14 w-14 rounded-xl border border-[#e1eaf4] bg-white object-contain" /> : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-50 text-red-500"><ImageOff className="h-5 w-5" /></div>}
                    <div className="min-w-0">
                      <Link href={`/products/${product.id}`} className="line-clamp-2 font-semibold text-gray-950 hover:text-blue-700">
                        {product.title ?? product.offerId}
                      </Link>
                      <div className="text-xs text-gray-500">{product.offerId}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{product.status}</td>
                <td className="px-4 py-3">
                  <div className="flex max-w-xl flex-wrap gap-1.5">
                    {issues.map((issue) => <Badge key={issue.label} tone={issue.tone}>{issue.label}</Badge>)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/products/${product.id}`} className="text-sm font-semibold text-blue-700 hover:underline">
                    查看并修复
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
