"use client";

import {
  BarChart3,
  ChevronRight,
  CircleAlert,
  Gauge,
  Megaphone,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { cn } from "./ui";

export type AgentInsightSource = {
  toolName: string;
  label: string;
  status: "ok" | "error";
  at: string;
  syncedAt?: string | null;
  storeName?: string | null;
  productCount?: number | null;
  visibleProductCount?: number | null;
  totalStock?: number | null;
  lowStockCount?: number | null;
  offerId?: string | null;
  productId?: string | null;
  stock?: number | null;
  actionCount?: number | null;
  candidateCount?: number | null;
  competitorReportCount?: number | null;
  analyzedProductCount?: number | null;
  competitorCount?: number | null;
  categories?: string[];
  contentDiagnosis?: unknown;
  financeDataAvailable?: boolean | null;
  lowContentRatingCount?: number | null;
  issues?: string[];
  lowContentRatingProducts?: Array<{
    offerId: string;
    title: string | null;
    imageUrl: string | null;
    contentRating: number;
    visible?: boolean | null;
    stock?: number | null;
    priceRub?: number | null;
    recommendations: string[];
  }>;
  error?: string | null;
};

const commands = [
  {
    title: "店铺深度诊断",
    detail: "经营指标 · 低分商品 · 待确认优化",
    prompt: "请对当前店铺做完整诊断，找出内容评分最低的商品，给出建议，并为最紧急的商品生成待确认优化方案。",
    icon: Gauge,
    className: "border-white bg-white/80 text-[#26334d] hover:border-[#cbdcff] hover:bg-white",
    iconClassName: "bg-[#eaf1ff] text-[#3478f6]",
  },
  {
    title: "活动机会中心",
    detail: "实时活动 · 候选商品 · 报名审批",
    prompt: "读取当前 Ozon 活动和候选商品，告诉我最值得关注的活动，不要直接报名。",
    icon: Megaphone,
    className: "border-white bg-white/80 text-[#26334d] hover:border-[#d9cdf8] hover:bg-white",
    iconClassName: "bg-[#f0eaff] text-[#7659d6]",
  },
];

export function AgentCommandDeck({
  disabled,
  onRun,
}: {
  disabled: boolean;
  onRun: (prompt: string) => void;
}) {
  return (
    <section className="border-b border-[#e3ebf5] bg-[linear-gradient(135deg,rgba(229,247,255,0.72),rgba(241,236,255,0.68))] px-4 py-3 md:px-5">
      <div className="w-full">
        <div className="flex items-center gap-1.5 text-xs font-bold text-[#3478f6]">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          AI ECOMMERCE COPILOT
        </div>
        <h1 className="mt-1 text-xl font-bold text-[#15213b]">今天想先优化哪一部分？</h1>
        <p className="mt-1 text-xs text-[#708099]">读取真实店铺和竞品数据，执行商品修改前由你确认。</p>
      </div>
      <div className="mt-3 grid w-full gap-3 md:grid-cols-3">
        {commands.map((command) => {
          const Icon = command.icon;
          return (
            <button
              key={command.title}
              type="button"
              disabled={disabled}
              onClick={() => onRun(command.prompt)}
              title={command.title}
              className={cn(
                "group flex min-h-16 items-center gap-3 rounded-2xl border p-3 text-left shadow-[0_8px_24px_rgba(52,80,124,0.07)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(52,80,124,0.11)] disabled:cursor-not-allowed disabled:opacity-50",
                command.className,
              )}
            >
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", command.iconClassName)}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{command.title}</span>
                <span className="mt-1 block text-xs leading-5 text-[#8290a8]">{command.detail}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="rounded-lg border border-[#e2eaf4] bg-white px-3 py-2" style={{ borderTopColor: accent }}>
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-black text-gray-950">{value}</div>
    </div>
  );
}

function DiagnosisInsight({ source }: { source: AgentInsightSource }) {
  const products = source.lowContentRatingProducts ?? [];
  return (
    <div className="rounded-xl border border-[#f3dfd2] bg-[#fffaf6] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-bold text-[#702400]">
          <Gauge className="h-4 w-4" aria-hidden="true" /> 店铺诊断快照
        </div>
        <span className="rounded-md bg-[#ff5b22] px-2 py-1 text-[11px] font-bold text-white">
          {source.financeDataAvailable ? "含财务流水" : "经营数据"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="商品总数" value={source.productCount ?? "-"} accent="#ff5b22" />
        <Metric label="低内容评分" value={source.lowContentRatingCount ?? 0} accent="#d858a8" />
        <Metric label="问题项" value={source.issues?.length ?? 0} accent="#f5c842" />
        <Metric label="数据状态" value={source.status === "ok" ? "已同步" : "异常"} accent="#18a7a0" />
      </div>
      {source.issues?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {source.issues.slice(0, 5).map((issue) => (
            <span key={issue} className="border-l-4 border-[#f5c842] bg-white px-2 py-1 text-xs text-gray-700">
              {issue}
            </span>
          ))}
        </div>
      ) : null}
      {products.length ? (
        <div className="mt-3 space-y-2">
          {products.slice(0, 5).map((product) => (
            <div key={product.offerId} className="grid grid-cols-[48px_1fr] gap-2 border-t border-[#ffd7be] pt-2 sm:grid-cols-[48px_1fr_100px]">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt=""
                  className="h-16 w-12 border border-[#ffd7be] bg-white object-contain"
                />
              ) : (
                <div className="flex h-16 w-12 items-center justify-center border border-dashed border-[#ffb27f] bg-white text-[10px] text-gray-400">无图</div>
              )}
              <div className="min-w-0">
                <div className="line-clamp-1 text-xs font-bold text-gray-950">{product.title ?? product.offerId}</div>
                <div className="mt-1 line-clamp-2 text-xs text-gray-600">
                  {product.recommendations.slice(0, 2).join("；") || "等待生成优化建议"}
                </div>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <div className="flex justify-between text-[11px] font-semibold text-gray-600">
                  <span>内容评分</span><span>{product.contentRating}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-sm bg-[#ffd7be]">
                  <div className="h-full bg-[#ff5b22]" style={{ width: `${Math.max(4, Math.min(product.contentRating, 100))}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function firstContentSample(source: AgentInsightSource) {
  const diagnosis = asRecord(source.contentDiagnosis);
  return asRecord(arrayValue(diagnosis.samples)[0]);
}

function contentSamples(source?: AgentInsightSource | null) {
  const diagnosis = asRecord(source?.contentDiagnosis);
  return arrayValue(diagnosis.samples).map(asRecord).filter((sample) => Object.keys(sample).length);
}

function termLabels(value: unknown) {
  return arrayValue(value)
    .map((item) => stringValue(asRecord(item).term))
    .filter((item): item is string => Boolean(item))
    .slice(0, 8);
}

function rub(value: unknown) {
  const number = numberValue(value);
  return number === null ? "-" : `${Math.round(number)} ₽`;
}

function shortText(value: unknown, fallback = "-") {
  const text = stringValue(value);
  if (!text) return fallback;
  return text.length > 70 ? `${text.slice(0, 70)}...` : text;
}

function percentLabel(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}分` : "-";
}

function problemSummary(product: NonNullable<AgentInsightSource["lowContentRatingProducts"]>[number]) {
  const text = product.recommendations.join(" ");
  const parts = [
    product.visible === false ? "不可见" : null,
    product.stock === 0 ? "无库存" : product.stock !== null && product.stock !== undefined && product.stock <= 5 ? "低库存" : null,
    /Аннотация|简介/i.test(text) ? "简介缺失" : null,
    /Видео|视频/i.test(text) ? "缺视频" : null,
    /изображ|图片|Изображения/i.test(text) ? "图片不足" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : product.recommendations[0] ?? "内容信息不完整";
}

function primaryStoreProblem(source?: AgentInsightSource | null) {
  if (!source) return "等待店铺诊断结果。";
  const productCount = source.productCount ?? 0;
  const visible = source.visibleProductCount ?? null;
  const invisible = visible === null ? null : Math.max(productCount - visible, 0);
  if (invisible && invisible > 0) {
    return `${invisible} 个商品当前不可见，近 30 天没有订单时应先排查可见性、库存、价格和审核状态。`;
  }
  if ((source.lowStockCount ?? 0) > 0) return `${source.lowStockCount} 个商品库存偏低，先确认是否需要补货。`;
  if ((source.lowContentRatingCount ?? 0) > 0) return `${source.lowContentRatingCount} 个商品内容分偏低，优先补简介、图片和视频。`;
  return "暂未发现高优先级异常，继续观察订单和内容质量。";
}

function StoreAnomalyOverview({ source }: { source?: AgentInsightSource | null }) {
  const productCount = source?.productCount ?? 0;
  const visible = source?.visibleProductCount ?? null;
  const invisible = visible === null ? null : Math.max(productCount - visible, 0);
  const products = source?.lowContentRatingProducts ?? [];
  const zeroStock = products.filter((product) => product.stock === 0).length;
  const lowStock = source?.lowStockCount ?? products.filter((product) =>
    typeof product.stock === "number" && product.stock > 0 && product.stock <= 5
  ).length;
  const issues = [
    invisible && invisible > 0
      ? { label: "商品不可见", value: invisible, action: "先查审核、价格、仓库和库存状态", tone: "bg-red-50 text-red-800 border-red-200" }
      : null,
    zeroStock > 0
      ? { label: "无库存样本", value: zeroStock, action: "确认是否补库存后再优化内容", tone: "bg-orange-50 text-orange-800 border-orange-200" }
      : null,
    lowStock > 0
      ? { label: "低库存商品", value: lowStock, action: "补货或暂停推广", tone: "bg-amber-50 text-amber-800 border-amber-200" }
      : null,
    (source?.lowContentRatingCount ?? 0) > 0
      ? { label: "低内容分", value: source?.lowContentRatingCount ?? 0, action: "补简介、图片、视频和真实属性", tone: "bg-blue-50 text-blue-800 border-blue-200" }
      : null,
  ].filter((item): item is { label: string; value: number; action: string; tone: string } => Boolean(item));

  return (
    <div className="rounded-2xl border border-[#f0d4c3] bg-[#fff8f3] p-4 shadow-[0_10px_28px_rgba(122,73,39,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-[#ff5b22]">店铺运营诊断报告</div>
          <div className="mt-1 text-base font-black text-gray-950">{primaryStoreProblem(source)}</div>
        </div>
        <span className="rounded-full bg-[#ff5b22] px-3 py-1 text-xs font-bold text-white">先处理异常，再优化内容</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <Metric label="可见商品" value={visible === null ? "-" : `${visible}/${productCount}`} accent="#ff5b22" />
        <Metric label="总库存" value={source?.totalStock ?? "-"} accent="#18a7a0" />
        <Metric label="低内容分" value={source?.lowContentRatingCount ?? 0} accent="#d858a8" />
        <Metric label="经营异常" value={issues.length || source?.issues?.length || 0} accent="#f5c842" />
      </div>

      {issues.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {issues.map((issue) => (
            <div key={issue.label} className={cn("rounded-xl border px-3 py-2", issue.tone)}>
              <div className="text-xs font-bold">{issue.label}：{issue.value}</div>
              <div className="mt-1 text-xs">{issue.action}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PriorityProducts({ source }: { source?: AgentInsightSource | null }) {
  const products = (source?.lowContentRatingProducts ?? []).slice(0, 4);
  if (!products.length) return null;
  return (
    <div className="rounded-2xl border border-[#dce8f5] bg-white p-4 shadow-[0_10px_28px_rgba(45,78,128,0.08)]">
      <div className="text-sm font-black text-gray-950">优先处理商品</div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        {products.map((product) => (
          <div key={product.offerId} className="grid grid-cols-[64px_1fr] gap-3 rounded-xl border border-[#e6edf6] bg-[#f8fbff] p-3">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt="" className="h-20 w-16 rounded-lg border bg-white object-contain" />
            ) : (
              <div className="flex h-20 w-16 items-center justify-center rounded-lg border border-dashed bg-white text-[10px] text-gray-400">无图</div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all text-xs font-black text-gray-950">{product.offerId}</span>
                <span className="rounded-full bg-[#fff0e7] px-2 py-0.5 text-[11px] font-bold text-[#c2410c]">
                  {percentLabel(product.contentRating)}
                </span>
              </div>
              <div className="mt-1 line-clamp-1 text-xs text-gray-600">{product.title ?? "未命名商品"}</div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-md bg-white px-2 py-1 text-gray-700">库存 {product.stock ?? "-"}</span>
                <span className="rounded-md bg-white px-2 py-1 text-gray-700">价格 {rub(product.priceRub)}</span>
                <span className="rounded-md bg-white px-2 py-1 text-gray-700">{product.visible === false ? "不可见" : "可见状态未知"}</span>
              </div>
              <div className="mt-2 text-xs font-semibold text-[#7c2d12]">{problemSummary(product)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function compareRows(sample: Record<string, unknown>) {
  const comparison = asRecord(sample.comparison);
  const title = asRecord(comparison.title);
  const mainImage = asRecord(comparison.mainImage);
  const price = asRecord(comparison.price);
  const heat = asRecord(comparison.heat);
  const themes = asRecord(comparison.themes);
  const description = asRecord(comparison.description);
  const own = asRecord(sample.own);
  const competitor = asRecord(arrayValue(sample.competitors)[0]);
  const competitorTitle = shortText(competitor.title, "本次未拿到竞品标题");
  const ownTitle = shortText(own.title, shortText(sample.offerId));
  const ownImageCount = numberValue(mainImage.ownImageCount) ?? numberValue(own.imageCount) ?? 0;
  const competitorImageCount = numberValue(mainImage.competitorMedianImageCount);
  const titleTerms = termLabels(themes.titleTerms).join("、");
  const descriptionTerms = termLabels(themes.descriptionTerms).join("、");
  return [
    {
      label: "标题",
      own: `${ownTitle}（${numberValue(title.ownLength) ?? "-"}字）`,
      competitor: `${competitorTitle}（中位${numberValue(title.competitorMedianLength) ?? "-"}字）`,
      action: (numberValue(title.ownLength) ?? 0) > (numberValue(title.competitorMedianLength) ?? 999)
        ? "压缩标题，保留品类、颜色、版型和面料"
        : "保留核心词，减少无效修饰",
    },
    {
      label: "主图",
      own: `${ownImageCount}张图${ownImageCount < 8 ? "，未达8张" : ""}`,
      competitor: competitorImageCount === null ? "竞品图片数未采到" : `竞品中位${competitorImageCount}张`,
      action: ownImageCount < 8 ? "补图到8张以上，优先补视频/视频封面" : "主图数量先不动，检查清晰度",
    },
    {
      label: "价格",
      own: rub(price.ownRub),
      competitor: numberValue(price.competitorMedianRub) === null ? "竞品价格未采到" : `竞品中位${rub(price.competitorMedianRub)}`,
      action: numberValue(price.competitorMedianRub) === null ? "暂不按价格调整" : "只作为定价参考，确认利润后再改价",
    },
    {
      label: "热度",
      own: `评价${numberValue(heat.ownReviewCount) ?? "-"}，不是销量`,
      competitor: `竞品评价中位${numberValue(heat.competitorMedianReviewCount) ?? "-"}，搜索位仅作参考`,
      action: "Ozon不返回真实销量，先恢复可见性和内容分",
    },
    {
      label: "关键词",
      own: titleTerms || "自家关键词弱",
      competitor: descriptionTerms || titleTerms || "竞品关键词未采到",
      action: "把高频俄语词自然写进标题和简介",
    },
    {
      label: "简介",
      own: description.ownAvailable ? "已有简介" : "简介为空",
      competitor: `竞品${numberValue(description.competitorAvailableCount) ?? 0}个有简介`,
      action: description.ownAvailable ? "优化表达，不复制竞品文案" : "补100-500字俄语简介",
    },
  ];
}

function CompetitorBusinessComparison({ source }: { source?: AgentInsightSource | null }) {
  const samples = contentSamples(source).slice(0, 4);
  if (!source) return null;
  if (!samples.length) {
    return (
      <div className="rounded-2xl border border-[#ccebe6] bg-[#f3fcfa] p-4">
        <div className="text-sm font-black text-[#075e5a]">同类竞品对比</div>
        <div className="mt-2 text-sm text-gray-600">本次没有拿到有效竞品页面，暂不生成竞品结论。</div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-[#ccebe6] bg-[#f3fcfa] p-4 shadow-[0_10px_28px_rgba(18,109,102,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-black text-[#075e5a]">
          <ScanSearch className="h-4 w-4" aria-hidden="true" /> 同类竞品对比
        </div>
        <span className="text-xs font-semibold text-[#087f78]">自家商品 / 竞品参考 / Agent建议</span>
      </div>
      <div className="mt-3 space-y-4">
        {samples.map((sample, index) => {
          const own = asRecord(sample.own);
          const competitors = arrayValue(sample.competitors).map(asRecord);
          const firstCompetitor = competitors[0];
          return (
            <div key={`${stringValue(sample.offerId) ?? index}`} className="overflow-hidden rounded-xl border border-[#ccebe6] bg-white">
              <div className="grid gap-3 border-b border-[#e4f4f1] bg-[#f8fffd] p-3 lg:grid-cols-[1fr_1fr]">
                <div className="grid grid-cols-[64px_1fr] gap-3">
                  {stringValue(own.imageUrl) ? (
                    <img src={stringValue(own.imageUrl)!} alt="" className="h-20 w-16 rounded-lg border bg-white object-contain" />
                  ) : (
                    <div className="flex h-20 w-16 items-center justify-center rounded-lg border border-dashed bg-white text-[10px] text-gray-400">自家无图</div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-[#087f78]">自家商品 · {stringValue(sample.categoryName) ?? "未知类目"}</div>
                    <div className="mt-1 break-all text-xs font-black text-gray-950">{stringValue(sample.offerId) ?? "-"}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-gray-600">{shortText(own.title, "未命名商品")}</div>
                    <div className="mt-1 text-[11px] text-gray-500">价格 {rub(own.priceRub)} · 评价 {numberValue(own.reviewCount) ?? "-"}</div>
                  </div>
                </div>
                <div className="grid grid-cols-[64px_1fr] gap-3">
                  {stringValue(firstCompetitor?.imageUrl) ? (
                    <img src={stringValue(firstCompetitor?.imageUrl)!} alt="" className="h-20 w-16 rounded-lg border bg-white object-contain" />
                  ) : (
                    <div className="flex h-20 w-16 items-center justify-center rounded-lg border border-dashed bg-white text-[10px] text-gray-400">竞品无图</div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-[#087f78]">竞品参考</div>
                    <a
                      href={stringValue(firstCompetitor?.url) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 line-clamp-2 text-xs font-black text-gray-950 hover:text-[#087f78]"
                    >
                      {shortText(firstCompetitor?.title, "本类目暂无有效竞品")}
                    </a>
                    <div className="mt-1 text-[11px] text-gray-500">
                      价格 {rub(firstCompetitor?.priceRub)} · 评分 {numberValue(firstCompetitor?.rating) ?? "-"} · 评价 {numberValue(firstCompetitor?.reviewCount) ?? "-"}
                    </div>
                    <div className="mt-1 line-clamp-1 text-[11px] text-gray-500">{shortText(firstCompetitor?.description, "暂无简介摘要")}</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-[70px_1fr_1fr_1fr] border-b border-[#e4f4f1] bg-[#ecfaf7] px-3 py-2 text-xs font-black text-[#075e5a]">
                <div>对比项</div>
                <div>自家商品</div>
                <div>竞品参考</div>
                <div>Agent 建议</div>
              </div>
              {compareRows(sample).map((row) => (
                <div key={row.label} className="grid grid-cols-[70px_1fr_1fr_1fr] border-b border-[#edf7f5] px-3 py-2 text-xs last:border-b-0">
                  <div className="font-bold text-[#075e5a]">{row.label}</div>
                  <div className="text-gray-700">{row.own}</div>
                  <div className="text-gray-700">{row.competitor}</div>
                  <div className="font-semibold text-gray-950">{row.action}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OperationsDiagnosisReport({ sources }: { sources: AgentInsightSource[] }) {
  const diagnosis = sources.find((source) => source.status === "ok" && source.toolName === "diagnose_ozon_store");
  const competitor = sources.find((source) => source.status === "ok" && source.toolName === "analyze_ozon_competitors");
  if (!diagnosis && !competitor) return null;
  return (
    <div className="space-y-3">
      <StoreAnomalyOverview source={diagnosis} />
      <PriorityProducts source={diagnosis} />
      <CompetitorBusinessComparison source={competitor} />
    </div>
  );
}

function CompetitorCards({ sample }: { sample: Record<string, unknown> }) {
  const competitors = arrayValue(sample.competitors).map(asRecord).slice(0, 6);
  if (!competitors.length) return null;
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {competitors.map((item, index) => (
        <a
          key={`${stringValue(item.url) ?? index}`}
          href={stringValue(item.url) ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="grid grid-cols-[58px_1fr] gap-2 rounded-lg border border-[#ccebe6] bg-white p-2 hover:border-[#54cfc4]"
        >
          {stringValue(item.imageUrl) ? (
            <img src={stringValue(item.imageUrl)!} alt="" className="h-20 w-14 rounded-md border bg-white object-contain" />
          ) : (
            <div className="flex h-20 w-14 items-center justify-center rounded-md border border-dashed bg-gray-50 text-[10px] text-gray-400">无图</div>
          )}
          <div className="min-w-0">
            <div className="line-clamp-2 text-xs font-bold text-gray-950">{stringValue(item.title) ?? "未命名竞品"}</div>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-gray-500">
              <span>{rub(item.priceRub)}</span>
              <span>{numberValue(item.rating) ? `评分 ${numberValue(item.rating)}` : "无评分"}</span>
              <span>{numberValue(item.reviewCount) ? `评价 ${numberValue(item.reviewCount)}` : "无评价数"}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-600">
              {stringValue(item.description) ?? "暂无简介摘要"}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

function FieldComparison({ sample }: { sample: Record<string, unknown> }) {
  const comparison = asRecord(sample.comparison);
  const title = asRecord(comparison.title);
  const mainImage = asRecord(comparison.mainImage);
  const price = asRecord(comparison.price);
  const heat = asRecord(comparison.heat);
  const themes = asRecord(comparison.themes);
  const description = asRecord(comparison.description);
  const rows = [
    ["标题", `自家 ${numberValue(title.ownLength) ?? "-"} 字`, `竞品中位 ${numberValue(title.competitorMedianLength) ?? "-"} 字`],
    ["主图", `自家 ${numberValue(mainImage.ownImageCount) ?? 0} 张`, `竞品中位 ${numberValue(mainImage.competitorMedianImageCount) ?? "-"} 张`],
    ["价格", rub(price.ownRub), `竞品中位 ${rub(price.competitorMedianRub)}`],
    ["热度", `评价 ${numberValue(heat.ownReviewCount) ?? "-"}`, `竞品评价中位 ${numberValue(heat.competitorMedianReviewCount) ?? "-"}`],
    ["主题词", termLabels(themes.titleTerms).join("、") || "-", termLabels(themes.descriptionTerms).join("、") || "-"],
    ["简介", description.ownAvailable ? "已有简介" : "缺少简介", `竞品 ${numberValue(description.competitorAvailableCount) ?? 0} 个有简介`],
  ];
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[#ccebe6] bg-white">
      {rows.map(([label, own, competitor]) => (
        <div key={label} className="grid grid-cols-[64px_1fr_1fr] border-b border-[#edf7f5] last:border-b-0">
          <div className="bg-[#f3fcfa] px-2 py-2 text-xs font-bold text-[#075e5a]">{label}</div>
          <div className="px-2 py-2 text-xs text-gray-700">{own}</div>
          <div className="px-2 py-2 text-xs text-gray-950">{competitor}</div>
        </div>
      ))}
    </div>
  );
}

function VisionSummary({ source }: { source: AgentInsightSource }) {
  const vision = asRecord(asRecord(source.contentDiagnosis).vision);
  const analyses = arrayValue(vision.analyses).map(asRecord).slice(0, 4);
  if (!analyses.length) {
    const warning = stringValue(vision.warning);
    return warning ? <div className="mt-3 border-l-4 border-[#f5c842] bg-white p-2 text-xs text-gray-600">{warning}</div> : null;
  }
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {analyses.map((item, index) => (
        <div key={`${stringValue(item.imageUrl) ?? index}`} className="rounded-lg border border-[#dce8f5] bg-white p-2 text-xs">
          <div className="font-bold text-gray-950">{stringValue(item.label) ?? `图片${index + 1}`} · {stringValue(item.imageType) ?? "未知"}</div>
          <div className="mt-1 text-gray-600">
            清晰度 {stringValue(item.clarity) ?? "unknown"}，商品突出度 {stringValue(item.productProminence) ?? "unknown"}，评分 {numberValue(item.mainImageScore) ?? "-"}
          </div>
          <div className="mt-1 text-gray-700">{stringValue(item.recommendationZh) ?? "需要人工复核"}</div>
        </div>
      ))}
    </div>
  );
}

function CompetitorInsight({ source }: { source: AgentInsightSource }) {
  const sample = firstContentSample(source);
  return (
    <div className="rounded-xl border border-[#ccebe6] bg-[#f3fcfa] p-3">
      <div className="flex items-center gap-2 font-bold text-[#075e5a]">
        <ScanSearch className="h-4 w-4" aria-hidden="true" /> 同类竞品内容对比
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="分析自家商品" value={source.analyzedProductCount ?? 0} accent="#087f78" />
        <Metric label="有效竞品样本" value={source.competitorCount ?? 0} accent="#f5c842" />
        <Metric label="搜索词覆盖" value={source.categories?.length ?? 0} accent="#d858a8" />
      </div>
      {source.categories?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {[...new Set(source.categories)].map((category) => (
            <span key={category} className="rounded-md border border-[#54cfc4] bg-white px-2 py-1 text-xs font-semibold text-[#075e5a]">
              {category}
            </span>
          ))}
        </div>
      ) : null}
      {Object.keys(sample).length ? (
        <>
          <FieldComparison sample={sample} />
          <VisionSummary source={source} />
          <CompetitorCards sample={sample} />
        </>
      ) : null}
    </div>
  );
}

function DefaultInsight({ source }: { source: AgentInsightSource }) {
  const metrics = [
    ["商品", source.productCount],
    ["库存", source.totalStock ?? source.stock],
    ["活动", source.actionCount],
    ["候选", source.candidateCount],
  ].filter((entry) => typeof entry[1] === "number") as Array<[string, number]>;
  return (
    <div className="rounded-xl border border-[#ddd8f3] bg-[#faf9ff] p-3">
      <div className="flex items-center gap-2 font-bold text-[#3d368d]">
        <BarChart3 className="h-4 w-4" aria-hidden="true" /> {source.label}
      </div>
      {metrics.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metrics.map(([label, value], index) => (
            <Metric key={label} label={label} value={value} accent={["#5d55c7", "#18a7a0", "#ff5b22", "#d858a8"][index] ?? "#5d55c7"} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AgentInsightPanel({ sources }: { sources?: AgentInsightSource[] }) {
  if (!sources?.length) return null;
  const reportSources = sources.filter((source) =>
    ["diagnose_ozon_store", "analyze_ozon_competitors"].includes(source.toolName)
  );
  const errorSources = sources.filter((source) => source.status === "error");
  const otherSources = sources.filter((source) =>
    source.status !== "error" &&
    !["diagnose_ozon_store", "analyze_ozon_competitors", "get_ozon_product_content"].includes(source.toolName)
  );
  return (
    <div className="mt-3 space-y-2">
      <OperationsDiagnosisReport sources={reportSources} />
      {errorSources.map((source, index) => (
        <div key={`${source.toolName}-${source.at}-${index}`} className="flex items-start gap-2 border-l-4 border-red-500 bg-red-50 p-3 text-xs text-red-800">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{source.label}：{source.error ?? "读取失败"}</span>
        </div>
      ))}
      {otherSources.map((source, index) => (
        <div key={`${source.toolName}-${source.at}-${index}`}>
          <DefaultInsight source={source} />
        </div>
      ))}
    </div>
  );
}
