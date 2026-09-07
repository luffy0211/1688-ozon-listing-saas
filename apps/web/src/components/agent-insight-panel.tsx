"use client";

import {
  Activity,
  BarChart3,
  Binoculars,
  ChevronRight,
  CircleAlert,
  Gauge,
  Megaphone,
  ScanSearch,
  ShieldCheck,
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
  competitorCount?: number | null;
  categories?: string[];
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
    className: "border-[#ff8a3d] bg-[#fff2e8] text-[#7a2d00] hover:bg-[#ffe4d1]",
    iconClassName: "bg-[#ff5b22] text-white",
  },
  {
    title: "搜索索引竞品雷达",
    detail: "搜索索引 · 属性描述 · 差距建议",
    prompt: "分析当前店铺商品的 Ozon 搜索索引相似竞品，并为差距最大的商品生成待确认优化方案。",
    icon: Binoculars,
    className: "border-[#18a7a0] bg-[#e7fbf8] text-[#075e5a] hover:bg-[#cef6f1]",
    iconClassName: "bg-[#087f78] text-white",
  },
  {
    title: "活动机会中心",
    detail: "实时活动 · 候选商品 · 报名审批",
    prompt: "读取当前 Ozon 活动和候选商品，告诉我最值得关注的活动，不要直接报名。",
    icon: Megaphone,
    className: "border-[#d858a8] bg-[#fff0f9] text-[#81235d] hover:bg-[#ffe0f3]",
    iconClassName: "bg-[#bd2f87] text-white",
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
    <section className="mb-4 overflow-hidden rounded-lg border-2 border-gray-950 bg-[#101828] shadow-[6px_6px_0_#f5c842]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#f5c842] text-gray-950">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <div className="text-sm font-bold">运营指挥台</div>
            <div className="text-xs text-gray-300">真实数据进入，修改动作必须确认</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-md bg-[#1fbd83] px-2 py-1 font-semibold text-gray-950">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" /> 实时读取
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-white">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> 人工审批
          </span>
        </div>
      </div>
      <div className="grid gap-2 p-3 md:grid-cols-3">
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
                "group flex min-h-24 items-center gap-3 rounded-md border-2 p-3 text-left transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50",
                command.className,
              )}
            >
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-md", command.iconClassName)}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{command.title}</span>
                <span className="mt-1 block text-xs leading-5 opacity-80">{command.detail}</span>
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
    <div className="border-l-4 bg-white px-3 py-2 shadow-sm" style={{ borderColor: accent }}>
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-black text-gray-950">{value}</div>
    </div>
  );
}

function DiagnosisInsight({ source }: { source: AgentInsightSource }) {
  const products = source.lowContentRatingProducts ?? [];
  return (
    <div className="border-l-4 border-[#ff5b22] bg-[#fff8f2] p-3">
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

function CompetitorInsight({ source }: { source: AgentInsightSource }) {
  return (
    <div className="border-l-4 border-[#087f78] bg-[#effcf9] p-3">
      <div className="flex items-center gap-2 font-bold text-[#075e5a]">
        <ScanSearch className="h-4 w-4" aria-hidden="true" /> 搜索索引竞品雷达
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="分析自家商品" value={source.competitorReportCount ?? 0} accent="#087f78" />
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
    <div className="border-l-4 border-[#5d55c7] bg-[#f6f5ff] p-3">
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
