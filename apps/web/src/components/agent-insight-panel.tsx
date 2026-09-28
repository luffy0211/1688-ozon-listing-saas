"use client";

import React from "react";
import {
  BarChart3,
  ChevronRight,
  CircleAlert,
  Gauge,
  Megaphone,
  Sparkles,
} from "lucide-react";
import { Button, cn } from "./ui";
import { CompetitorComparison, type ComparisonAction } from "./competitor-comparison";
export { safeExternalUrl } from "./competitor-comparison";
import { displayProductImageUrl } from "@/lib/product-image";
import { contentOptimizationRequested, contentWorkExcluded, competitorWorkExcluded, operationalTaskOnly } from "@/lib/agent/task-scope";

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

type AgentInsightAction = ComparisonAction;

export type AgentInsightPresentation = {
  showStoreDiagnosis: boolean;
  showContentDiagnosis: boolean;
  showContentProducts: boolean;
  showCompetitorComparison: boolean;
};

export function insightPresentationFor(
  requestPrompt: string,
  actions: AgentInsightAction[],
): AgentInsightPresentation {
  const contentFocused = /(?:商品内容|内容评分|商品优化|优化商品)|(?:内容|文案).{0,8}(?:诊断|体检|优化|改进|修改|草案|草稿)|(?:诊断|体检|优化|改进|修改|生成).{0,8}(?:内容|文案|标题|描述|简介|关键词|图片|主图|视频|属性|草案|草稿)|(?:content|listing|draft)/i.test(requestPrompt);
  const competitorFocused = /(?:竞品|竞争对手|同款|对比)/i.test(requestPrompt);
  const otherFocusedTask = /(?:库存|仓库|补货|价格|售价|活动|促销|报名|上架|下架|归档|类目).{0,8}(?:诊断|分析|检查|修改|调整)|(?:诊断|分析|检查|修改|调整|只看|重点看).{0,8}(?:库存|仓库|补货|价格|售价|活动|促销|报名|上架|下架|归档|类目)/i.test(requestPrompt);
  const storeDiagnosis = /(?:店铺|经营|运营).{0,8}(?:诊断|体检|分析)|(?:诊断|体检|分析).{0,8}(?:店铺|经营|运营)/i.test(requestPrompt);
  const broadStoreDiagnosis = storeDiagnosis && /(?:完整|全面|深度|全部|所有)/i.test(requestPrompt);
  const hasContentDraft = actions.some((action) => action.type === "CONTENT_DRAFT");
  const showContentDiagnosis = !contentWorkExcluded(requestPrompt) && (contentFocused || contentOptimizationRequested(requestPrompt));

  return {
    showStoreDiagnosis: broadStoreDiagnosis || (
      storeDiagnosis && !showContentDiagnosis && !competitorFocused && !otherFocusedTask
    ),
    showContentDiagnosis,
    showContentProducts: showContentDiagnosis && !hasContentDraft,
    showCompetitorComparison: !competitorWorkExcluded(requestPrompt) && !operationalTaskOnly(requestPrompt)
      && (competitorFocused || showContentDiagnosis || (broadStoreDiagnosis && !contentWorkExcluded(requestPrompt))),
  };
}

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

function rub(value: unknown) {
  const number = numberValue(value);
  return number === null ? "-" : `${Math.round(number)} ₽`;
}

function percentLabel(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}分` : "-";
}

function problemSummary(product: NonNullable<AgentInsightSource["lowContentRatingProducts"]>[number]) {
  const text = product.recommendations.join(" ");
  const parts = [
    /Аннотация|简介/i.test(text) ? "简介缺失" : null,
    /Видео|视频/i.test(text) ? "缺视频" : null,
    /изображ|图片|Изображения/i.test(text) ? "图片不足" : null,
    /атрибут|属性/i.test(text) ? "属性不完整" : null,
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

function StoreAnomalyOverview({
  source,
  onRun,
}: {
  source?: AgentInsightSource | null;
  onRun?: (prompt: string) => void;
}) {
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
      ? {
          label: "商品不可见",
          value: invisible,
          action: "查清哪些商品不可见以及平台已返回的原因",
          prompt: "请只查看当前不可见商品，说明已确认原因和下一步，不要直接修改。",
          tone: "bg-red-50 text-red-800 border-red-200",
        }
      : null,
    zeroStock > 0
      ? {
          label: "无库存商品",
          value: zeroStock,
          action: "查看商品和可用仓库，再决定是否生成库存草案",
          prompt: "请只查看当前无库存商品和可用仓库，告诉我可执行的下一步，不要直接修改库存。",
          tone: "bg-orange-50 text-orange-800 border-orange-200",
        }
      : null,
    lowStock > 0
      ? {
          label: "低库存商品",
          value: lowStock,
          action: "先查看具体商品和可用仓库",
          prompt: "请只分析当前低库存商品，列出具体商品和可执行的处理步骤，不要直接修改库存。",
          tone: "bg-amber-50 text-amber-800 border-amber-200",
        }
      : null,
    (source?.lowContentRatingCount ?? 0) > 0
      ? {
          label: "低内容分",
          value: source?.lowContentRatingCount ?? 0,
          action: "查看 Ozon 返回的具体内容缺项",
          prompt: "请只做商品内容诊断，列出内容评分最低的商品和 Ozon 官方改进项，不要分析库存或其他经营问题。",
          tone: "bg-blue-50 text-blue-800 border-blue-200",
        }
      : null,
  ].filter((item): item is { label: string; value: number; action: string; prompt: string; tone: string } => Boolean(item));

  return (
    <div className="rounded-2xl border border-[#f0d4c3] bg-[#fff8f3] p-4 shadow-[0_10px_28px_rgba(122,73,39,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-[#ff5b22]">店铺运营诊断报告</div>
          <div className="mt-1 text-base font-black text-gray-950">{primaryStoreProblem(source)}</div>
        </div>
        <span className="rounded-full bg-[#ff5b22] px-3 py-1 text-xs font-bold text-white">选择一项继续处理</span>
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
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-8 bg-white px-2 text-xs"
                onClick={() => onRun?.(issue.prompt)}
              >
                查看并处理
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContentDiagnosisOverview({
  source,
  draftCount,
}: {
  source?: AgentInsightSource | null;
  draftCount: number;
}) {
  if (!source) return null;
  const recommendations = [...new Set(
    (source.lowContentRatingProducts ?? []).flatMap((product) => product.recommendations),
  )].slice(0, 4);
  return (
    <div className="rounded-2xl border border-[#dce8f5] bg-[#f8fbff] p-4 shadow-[0_10px_28px_rgba(45,78,128,0.08)]">
      <div className="text-xs font-black uppercase tracking-wide text-[#3478f6]">商品内容诊断</div>
      <div className="mt-1 text-base font-black text-gray-950">
        {source.lowContentRatingCount ?? 0} 个商品内容分偏低
      </div>
      <div className="mt-1 text-xs text-gray-600">
        {draftCount > 0
          ? `本轮已生成 ${draftCount} 份内容草案，请在下方查看处理状态。`
          : "建议从内容评分最低的商品开始处理。"}
      </div>
      {recommendations.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {recommendations.map((recommendation) => (
            <span key={recommendation} className="rounded-md bg-white px-2 py-1 text-xs text-gray-700">
              {recommendation}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PriorityProducts({
  source,
  onRun,
}: {
  source?: AgentInsightSource | null;
  onRun?: (prompt: string) => void;
}) {
  const products = (source?.lowContentRatingProducts ?? []).slice(0, 4);
  if (!products.length) return null;
  return (
    <div className="rounded-2xl border border-[#dce8f5] bg-white p-4 shadow-[0_10px_28px_rgba(45,78,128,0.08)]">
      <div className="text-sm font-black text-gray-950">需要优化的商品</div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        {products.map((product) => (
          <div key={product.offerId} className="grid grid-cols-[64px_1fr] gap-3 rounded-xl border border-[#e6edf6] bg-[#f8fbff] p-3">
            {product.imageUrl ? (
              <img src={displayProductImageUrl(product.imageUrl)} alt="" className="h-20 w-16 rounded-lg border bg-white object-contain" />
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
              <div className="mt-2 text-xs font-semibold text-[#7c2d12]">{problemSummary(product)}</div>
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-8 px-2 text-xs"
                onClick={() => onRun?.(
                  `请只优化商品 ${product.offerId} 的内容。读取真实商品信息，说明内容问题，并生成待确认内容草案；不要分析库存或其他店铺经营问题。`,
                )}
              >
                生成内容草案
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperationsDiagnosisReport({
  sources,
  presentation,
  actions,
  onRun,
  onOpenDraft,
  activeStoreId,
}: {
  sources: AgentInsightSource[];
  presentation: AgentInsightPresentation;
  actions: AgentInsightAction[];
  onRun?: (prompt: string) => void;
  onOpenDraft?: (id: string) => void;
  activeStoreId?: string;
}) {
  const diagnosis = sources.find((source) => source.status === "ok" && source.toolName === "diagnose_ozon_store");
  const competitor = sources.find((source) => source.status === "ok" && source.toolName === "analyze_ozon_competitors");
  if (!diagnosis && !competitor && !presentation.showCompetitorComparison) return null;
  const draftCount = actions.filter((action) => action.type === "CONTENT_DRAFT").length;
  return (
    <div className="space-y-3">
      {presentation.showStoreDiagnosis ? <StoreAnomalyOverview source={diagnosis} onRun={onRun} /> : null}
      {presentation.showContentDiagnosis ? (
        <ContentDiagnosisOverview source={diagnosis} draftCount={draftCount} />
      ) : null}
      {presentation.showContentProducts ? <PriorityProducts source={diagnosis} onRun={onRun} /> : null}
      {presentation.showCompetitorComparison ? <CompetitorComparison source={competitor} actions={actions} activeStoreId={activeStoreId} onRun={onRun} onOpenDraft={onOpenDraft} /> : null}
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

export function AgentInsightPanel({
  sources,
  requestPrompt = "",
  actions = [],
  onRun,
  onOpenDraft,
  activeStoreId,
}: {
  sources?: AgentInsightSource[];
  requestPrompt?: string;
  actions?: AgentInsightAction[];
  onRun?: (prompt: string) => void;
  onOpenDraft?: (id: string) => void;
  activeStoreId?: string;
}) {
  if (!sources?.length) return null;
  const presentation = insightPresentationFor(requestPrompt, actions);
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
      <OperationsDiagnosisReport
        sources={reportSources}
        presentation={presentation}
        actions={actions}
        onRun={onRun}
        onOpenDraft={onOpenDraft}
        activeStoreId={activeStoreId}
      />
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
