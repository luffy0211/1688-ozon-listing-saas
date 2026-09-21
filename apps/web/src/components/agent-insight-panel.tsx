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
  return (
    <div className="mt-3 space-y-2">
      {sources.map((source, index) => (
        <div key={`${source.toolName}-${source.at}-${index}`}>
          {source.status === "error" ? (
            <div className="flex items-start gap-2 border-l-4 border-red-500 bg-red-50 p-3 text-xs text-red-800">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{source.label}：{source.error ?? "读取失败"}</span>
            </div>
          ) : source.toolName === "diagnose_ozon_store" ? (
            <DiagnosisInsight source={source} />
          ) : source.toolName === "analyze_ozon_competitors" ? (
            <CompetitorInsight source={source} />
          ) : (
            <DefaultInsight source={source} />
          )}
        </div>
      ))}
    </div>
  );
}
