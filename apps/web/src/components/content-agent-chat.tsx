"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  MoreHorizontal,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Badge, Button, Select, cn } from "./ui";
import {
  AgentCommandDeck,
  AgentInsightPanel,
  type AgentInsightSource,
} from "./agent-insight-panel";
import { ContentDraftGroup } from "./content-agent-drafts";
import { buildPendingAgentExecutionTrace } from "@/lib/agent/execution-trace";
import type { AgentExecutionStep as AgentTimelineStep } from "@/lib/agent/execution-trace";
import { validateContentDraftEdits } from "@/lib/agent/content-draft-edits";

type StoreOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

type SessionOption = {
  id: string;
  title: string | null;
  status: string;
  updatedAt: string;
};

type AgentConfig = {
  configured: boolean;
  missing: string[];
  message: string;
};

export type ContentAgentActionView = {
  id: string;
  type: string;
  status: string;
  riskLevel: string;
  title: string;
  rationale: string;
  storeId: string | null;
  offerId: string | null;
  productId: string | null;
  payload: unknown;
  guardrail: unknown;
  executionPhase?: "executing" | "verification_pending" | "manual_required" | "finished" | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  requestPrompt?: string;
  actions?: ContentAgentActionView[];
  dataSources?: AgentInsightSource[];
  plan?: AgentTimelineStep[];
  executionTrace?: AgentTimelineStep[];
};

export function shouldShowCommandDeck(messages: Array<Pick<ChatMessage, "role">>) {
  return !messages.some((message) => message.role === "user");
}

export function shouldSubmitChatKey(event: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

type PersistedChatMessage = ChatMessage & {
  createdAt: string;
};

export function mapPersistedChatMessage(message: PersistedChatMessage): ChatMessage {
  const traceIsComplete = message.executionTrace?.some((step) =>
    ["succeeded", "waiting", "skipped"].includes(step.status),
  ) && !message.executionTrace.some((step) => ["running", "failed"].includes(step.status));
  const executionTrace = traceIsComplete
    ? message.executionTrace?.map((step) =>
        step.status === "pending" && ["SUMMARIZE_CATEGORY_PLAYBOOK", "DIAGNOSE_PRODUCTS"].includes(step.kind)
          ? { ...step, status: "succeeded" as const, outputSummary: step.outputSummary ?? "已完成分析" }
          : step,
      )
    : message.executionTrace;
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    requestPrompt: message.requestPrompt,
    actions: message.actions,
    dataSources: message.dataSources,
    plan: message.plan,
    executionTrace,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function suggestionsFromPayload(payload: unknown) {
  const suggestions = asRecord(payload).suggestions;
  return Array.isArray(suggestions) ? suggestions.slice(0, 6) : [];
}

export function attributeChangesFromPayload(payload: unknown) {
  const recommendations = asRecord(payload).recommendations;
  if (!Array.isArray(recommendations)) return [];
  return recommendations.flatMap((value) => {
    const item = asRecord(value);
    const offerId = typeof item.offerId === "string" ? item.offerId.trim() : "";
    const attributeName = typeof item.ozonNameRu === "string" && item.ozonNameRu.trim()
      ? item.ozonNameRu.trim()
      : typeof item.competitorNameRu === "string" ? item.competitorNameRu.trim() : "";
    const suggestedValue = typeof item.suggestedValue === "string" ? item.suggestedValue.trim() : "";
    if (!offerId || !attributeName || !suggestedValue) return [];
    const evidenceUrls = Array.isArray(item.evidenceUrls)
      ? item.evidenceUrls.filter((url): url is string => typeof url === "string" && /^https:\/\//.test(url))
      : [];
    return [{
      offerId,
      attributeName,
      suggestedValue,
      required: item.required === true,
      reasonZh: typeof item.reasonZh === "string" ? item.reasonZh : "",
      evidenceUrl: evidenceUrls[0] ?? null,
    }];
  });
}

function toneForStatus(status: string) {
  if (status === "APPROVED") return "green";
  if (status === "REJECTED" || status === "FAILED") return "red";
  if (status === "BLOCKED") return "amber";
  if (status === "PENDING_APPROVAL") return "amber";
  return "blue";
}

function toneForRisk(risk: string) {
  if (risk === "HIGH") return "red";
  if (risk === "MEDIUM") return "amber";
  return "gray";
}

function fieldLabel(field: unknown) {
  const labels: Record<string, string> = {
    title: "标题",
    keywords: "关键词",
    description: "描述",
    attributes: "属性",
  };
  const key = String(field ?? "content");
  return labels[key] ?? key;
}

function promotionFieldLabel(field: unknown) {
  const labels: Record<string, string> = {
    stock: "库存",
    currentPrice: "当前价",
    actionPrice: "活动价",
    maxActionPrice: "最高活动价",
    discountRate: "折扣率",
    orders30d: "30天订单",
    revenue30d: "30天销售额",
    ozonNetPayout: "Ozon净回款",
    contentRating: "内容评分",
  };
  return labels[String(field ?? "")] ?? String(field ?? "");
}

function promotionOperatorLabel(operator: unknown) {
  return ({ gte: "≥", lte: "≤", eq: "=", in: "属于", not_in: "不属于" } as Record<string, string>)[
    String(operator ?? "")
  ] ?? String(operator ?? "");
}

function promotionPriceRuleLabel(value: unknown) {
  const rule = asRecord(value);
  const amount = Number(rule.value);
  switch (rule.mode) {
    case "multiplier":
      return Number.isFinite(amount) ? `当前价 × ${amount}` : "当前价折扣";
    case "percent_off":
      return Number.isFinite(amount) ? `当前价减 ${Math.round(amount * 100)}%` : "按百分比降价";
    case "amount_off":
      return Number.isFinite(amount) ? `当前价减 ${amount}` : "按固定金额降价";
    case "fixed":
      return Number.isFinite(amount) ? `固定活动价 ${amount}` : "固定活动价";
    case "ozon_max":
      return "使用 Ozon 返回的最高活动价";
    case "formula": {
      const parts = [`公式：${String(rule.expression ?? "")}`];
      const defaults = asRecord(rule.defaults);
      const defaultText = Object.entries(defaults)
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([key, value]) => `${key}=${String(value)}`)
        .join("，");
      if (defaultText) parts.push(`默认值：${defaultText}`);
      if (rule.rounding) parts.push(`取整：${String(rule.rounding)}`);
      if (Number.isFinite(Number(rule.minGrossMarginRate))) {
        parts.push(`最低毛利率：${Math.round(Number(rule.minGrossMarginRate) * 100)}%`);
      }
      if (Number.isFinite(Number(rule.minProfitRub))) {
        parts.push(`最低利润：${String(rule.minProfitRub)}`);
      }
      return parts.join(" · ");
    }
    default:
      return "";
  }
}

function promotionScopeLabel(value: unknown) {
  const scope = asRecord(value);
  const parts: string[] = [];
  const arrayText = (items: unknown) =>
    Array.isArray(items)
      ? items.map((item) => String(item)).filter(Boolean).slice(0, 6).join("、")
      : "";
  const offerIds = arrayText(scope.offerIds);
  const prefixes = arrayText(scope.offerIdPrefixes);
  const categories = arrayText(scope.descriptionCategoryIds);
  const typeIds = arrayText(scope.typeIds);
  const categoryKeys = arrayText(scope.categoryKeys);
  if (offerIds) parts.push(`offerId：${offerIds}`);
  if (prefixes) parts.push(`offerId前缀：${prefixes}`);
  if (categories) parts.push(`类目：${categories}`);
  if (typeIds) parts.push(`类型：${typeIds}`);
  if (categoryKeys) parts.push(`类目组合：${categoryKeys}`);
  const priceRange = asRecord(scope.priceRange);
  const min = Number(priceRange.min);
  const max = Number(priceRange.max);
  if (Number.isFinite(min) || Number.isFinite(max)) {
    parts.push(`价格：${Number.isFinite(min) ? min : "不限"}-${Number.isFinite(max) ? max : "不限"}`);
  }
  return parts.join(" · ");
}

function actionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    CONTENT_DRAFT: "内容草稿",
    PUBLISH_DRAFT: "发布草稿",
    UPDATE_PRICE: "改价",
    UPDATE_STOCK: "改库存",
    UPDATE_IMAGES: "改图片",
    UPDATE_ATTRIBUTES: "改属性",
    UPDATE_CATEGORY: "改类目",
    ARCHIVE_PRODUCT: "归档商品",
    UNARCHIVE_PRODUCT: "恢复商品",
    DELETE_PRODUCT: "删除商品",
    BULK_PRODUCT_UPDATE: "批量修改商品",
    PROMOTION_POLICY: "活动报名规则",
    PROMOTION_ENROLLMENT: "活动报名",
  };
  return labels[type] ?? type;
}

function actionPayloadSummary(action: ContentAgentActionView) {
  const payload = asRecord(action.payload);
  const parts: string[] = [];
  const push = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) parts.push(`${label}: ${value}`);
    if (typeof value === "number" && Number.isFinite(value)) parts.push(`${label}: ${value}`);
  };
  push("offerId", action.offerId ?? payload.offerId);
  push("productId", action.productId ?? payload.productId);
  push("价格", payload.proposedPriceRub ?? payload.price);
  push("库存", payload.stock);
  push("仓库", payload.warehouseId ?? payload.warehouse_id);
  const images = Array.isArray(payload.images) ? payload.images.length : null;
  if (images) parts.push(`图片: ${images} 张`);
  const attributes = Array.isArray(payload.attributes) ? payload.attributes.length : null;
  if (attributes) parts.push(`属性: ${attributes} 个`);
  const items = Array.isArray(payload.items) ? payload.items.length : null;
  if (items) parts.push(`批量: ${items} 个商品`);
  const products = Array.isArray(payload.products) ? payload.products.length : null;
  if (products) parts.push(`报名商品: ${products} 个`);
  const rule = asRecord(payload.rule);
  const conditions = Array.isArray(rule.all) ? rule.all.length : null;
  if (conditions) parts.push(`规则条件: ${conditions} 条`);
  push("活动ID", payload.actionId);
  return parts.slice(0, 6).join(" · ");
}

function actionExecutionSummary(action: ContentAgentActionView) {
  const execution = asRecord(asRecord(action.guardrail).execution);
  if (execution.kind === "UPDATE_STOCK") {
    return execution.phase === "verification_pending"
      ? "Ozon 已接收，正在等待库存同步"
      : asRecord(execution.verification).stock === execution.stock
        ? "库存已回读核实"
        : "";
  }
  if (execution.kind === "BULK_PRODUCT_UPDATE") {
    const executed = Number(execution.executed ?? 0);
    const failed = Number(execution.failed ?? 0);
    const pending = Number(execution.pending ?? 0);
    return [executed ? `${executed} 项成功` : "", failed ? `${failed} 项失败` : "", pending ? `${pending} 项待核实` : ""]
      .filter(Boolean)
      .join("，");
  }
  if (execution.kind !== "CONTENT_DRAFT") return "";
  const verification = asRecord(execution.verification);
  const changedFields = Array.isArray(execution.changedFields)
    ? execution.changedFields.map(String)
    : [];
  const parts = [];
  if (changedFields.includes("title") && verification.titleApplied) {
    parts.push("标题已写入");
  }
  if (changedFields.includes("description") && verification.descriptionApplied) {
    parts.push(
      verification.descriptionSource === "attribute_4191"
        ? "描述已写入 Ozon 描述属性"
        : "描述已写入",
    );
  }
  return parts.join(" · ");
}

function friendlyActionError(error: string | null) {
  if (!error) return "";
  if (error.startsWith("content_draft_stale_target_fields:")) {
    return "草案目标字段已在 Ozon 发生变化，请重新读取并确认新版本。";
  }
  const messages: Record<string, string> = {
    content_draft_not_reflected_after_import: "Ozon 已接收任务，但内容同步超时，请稍后刷新商品内容。",
    execution_in_progress: "任务正在执行，请稍后刷新状态。",
    result_pending_verification: "Ozon 已接收任务，结果仍在同步中，请不要重复提交。",
    partial_execution: "部分商品已执行，失败项未写入；请查看明细后单独处理。",
    verification_expired: "平台结果仍无法确认，需要人工核对；系统不会自动重复写入。",
    content_agent_interrupted: "任务因服务中断而结束，请重新发起本次诊断。",
    real_ozon_submit_disabled: "真实 Ozon 写入开关未开启，当前不能执行。",
  };
  return messages[error] ?? error;
}

function formatTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function introMessageFor(agentConfig: AgentConfig): ChatMessage {
  return {
    id: "intro",
    role: "assistant",
    content: agentConfig.configured
      ? "你可以直接让 Agent 做店铺诊断、商品优化和 Ozon 活动建议。需要市场参考时再采集竞品；任何商品改动或活动报名都必须先生成待确认动作。"
      : agentConfig.message,
  };
}

function upsertSession(sessions: SessionOption[], session: SessionOption) {
  return [session, ...sessions.filter((item) => item.id !== session.id)].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function initialContentAgentSessionId(sessions: SessionOption[]) {
  return [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]?.id ?? "new";
}

export function sessionsAfterArchive(
  sessions: SessionOption[],
  archivedSessionId: string,
  selectedSessionId: string,
) {
  const remaining = sessions.filter((session) => session.id !== archivedSessionId);
  return {
    sessions: remaining,
    selectedSessionId: selectedSessionId === archivedSessionId
      ? initialContentAgentSessionId(remaining)
      : selectedSessionId,
  };
}

function sessionTitleFromPrompt(prompt: string) {
  const compact = prompt.trim().replace(/\s+/g, " ");
  return compact.length > 36 ? `${compact.slice(0, 36)}...` : compact || "Ozon Agent";
}

async function postJson(path: string, payload: unknown = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error?.message ?? "请求失败");
  }
  return json.data;
}

async function getJson(path: string) {
  const response = await fetch(path);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error?.message ?? "加载历史失败");
  }
  return json.data;
}

async function deleteJson(path: string) {
  const response = await fetch(path, { method: "DELETE" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error?.message ?? "删除对话失败");
  return json.data;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const runningToolLabels: Record<string, string> = {
  get_ozon_store_snapshot: "正在读取店铺数据...",
  get_ozon_product_content: "正在读取商品内容...",
  diagnose_ozon_store: "正在诊断店铺经营情况...",
  analyze_ozon_competitors: "正在采集并分析竞品数据...",
  list_ozon_promotions: "正在读取 Ozon 活动...",
  get_ozon_promotion_candidates: "正在读取活动候选商品...",
  compile_promotion_policy: "正在整理活动报名规则...",
  propose_promotion_enrollment: "正在生成活动报名方案...",
  propose_content_draft: "正在生成内容修改建议...",
  propose_product_mutation_actions: "正在生成待确认修改动作...",
};

const runningKindLabels: Record<string, string> = {
  RECEIVE_TASK: "正在接收任务...",
  PLAN_TASK: "正在规划执行步骤...",
  READ_STORE_SNAPSHOT: "正在读取店铺数据...",
  READ_PRODUCT_CONTENT: "正在读取商品内容...",
  DIAGNOSE_STORE: "正在诊断店铺经营情况...",
  COLLECT_COMPETITORS: "正在采集并分析竞品数据...",
  SUMMARIZE_CATEGORY_PLAYBOOK: "正在总结竞品内容规律...",
  DIAGNOSE_PRODUCTS: "正在检查自家商品差距...",
  LIST_PROMOTIONS: "正在读取 Ozon 活动...",
  READ_PROMOTION_CANDIDATES: "正在读取活动候选商品...",
  COMPILE_PROMOTION_POLICY: "正在整理活动报名规则...",
  PROPOSE_PROMOTION_ENROLLMENT: "正在生成活动报名方案...",
  CREATE_ACTIONS: "正在生成待确认建议...",
  WAIT_FOR_APPROVAL: "正在准备人工确认项...",
  DIRECT_ANSWER: "正在整理回复...",
};

function runningAgentStatus(steps: AgentTimelineStep[]) {
  const current =
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status === "pending") ??
    null;
  if (!current) return "Agent 正在处理...";
  return (
    runningToolLabels[current.toolName ?? ""] ??
    runningToolLabels[current.expectedTool ?? ""] ??
    runningKindLabels[current.kind] ??
    "Agent 正在处理..."
  );
}

async function pollAgentRunTrace(
  runId: string,
  onUpdate: (trace: AgentTimelineStep[]) => void,
) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const data = await getJson(`/api/v1/agent/runs/${runId}/trace`);
    if (Array.isArray(data.executionTrace)) {
      onUpdate(data.executionTrace);
    }
    if (data.status === "succeeded" || data.status === "failed") {
      return data;
    }
    await wait(1000);
  }
  throw new Error("Agent 执行超时，请到任务中心查看结果。");
}

function replaceAction(messages: ChatMessage[], action: ContentAgentActionView): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    actions: message.actions?.map((item) => (item.id === action.id ? action : item)),
  }));
}

function ActionBubble({
  action,
  onCommand,
}: {
  action: ContentAgentActionView;
  onCommand: (actionId: string, command: "confirm-execute" | "reject" | "execute", payload?: unknown) => void;
}) {
  const suggestions = suggestionsFromPayload(action.payload);
  const [editableSuggestions, setEditableSuggestions] = useState(() => suggestions.map((suggestion) => ({
    ...asRecord(suggestion),
    suggestedRu: String(asRecord(suggestion).suggestedRu ?? ""),
  })));
  const payload = asRecord(action.payload);
  const executionSummary = actionExecutionSummary(action);
  const actionError = friendlyActionError(action.error);
  const attributeChanges = attributeChangesFromPayload(action.payload);
  const isCompetitorBatch = action.type === "BULK_PRODUCT_UPDATE" && payload.source === "competitor_attribute_playbook";
  const ruleConditions = Array.isArray(asRecord(payload.rule).all)
    ? (asRecord(payload.rule).all as unknown[])
    : [];
  const promotionProducts = Array.isArray(payload.products)
    ? payload.products.slice(0, 20)
    : [];
  const promotionRejected = Array.isArray(payload.rejected)
    ? payload.rejected.slice(0, 8)
    : [];
  const priceRuleLabel = promotionPriceRuleLabel(payload.priceRule);
  const scopeLabel = promotionScopeLabel(payload.scope);
  const canEditContentDraft = action.type === "CONTENT_DRAFT" && action.status === "PENDING_APPROVAL";
  const executableEdits = editableSuggestions.filter((suggestion) =>
    ["title", "description"].includes(String(asRecord(suggestion).field ?? "")),
  );
  const editValidation = canEditContentDraft ? validateContentDraftEdits(executableEdits) : null;

  useEffect(() => {
    setEditableSuggestions(suggestions.map((suggestion) => ({
      ...asRecord(suggestion),
      suggestedRu: String(asRecord(suggestion).suggestedRu ?? ""),
    })));
  }, [action.id, action.updatedAt]);

  return (
    <section className="mt-3 rounded-xl border border-[#dfe8f4] bg-[#f8fbff] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={toneForStatus(action.status)}>{action.status}</Badge>
        <Badge tone={toneForRisk(action.riskLevel)}>{action.riskLevel}</Badge>
        <span className="rounded-md bg-[#26334d] px-2 py-1 text-xs font-semibold text-white">{actionTypeLabel(action.type)}</span>
      </div>
      <div className="mt-2 text-sm font-semibold text-gray-950">{action.title}</div>
      <div className="mt-1 text-sm leading-6 text-gray-600">{action.rationale}</div>
      {actionPayloadSummary(action) ? (
        <div className="mt-2 text-xs text-gray-500">{actionPayloadSummary(action)}</div>
      ) : null}
      {executionSummary ? (
        <div className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
          {executionSummary}
        </div>
      ) : null}
      {actionError ? <div className="mt-2 text-xs text-red-600">{actionError}</div> : null}

      {ruleConditions.length ? (
        <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-700">
          <div className="mb-1 font-medium text-gray-950">确认后生效的规则</div>
          {priceRuleLabel ? (
            <div className="mb-1 rounded-md bg-white px-2 py-1 font-semibold text-[#075e5a]">
              活动价：{priceRuleLabel}
            </div>
          ) : null}
          {scopeLabel ? (
            <div className="mb-1 rounded-md bg-white px-2 py-1 font-semibold text-[#26334d]">
              适用范围：{scopeLabel}
            </div>
          ) : null}
          {ruleConditions.map((condition, index) => {
            const item = asRecord(condition);
            const value = Array.isArray(item.value) ? item.value.join("、") : String(item.value ?? "");
            return (
              <div key={index} className="py-0.5">
                {promotionFieldLabel(item.field)} {promotionOperatorLabel(item.operator)} {value}
              </div>
            );
          })}
        </div>
      ) : null}

      {!ruleConditions.length && priceRuleLabel ? (
        <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-700">
          <div className="mb-1 font-medium text-gray-950">活动价计算方法</div>
          <div className="rounded-md bg-white px-2 py-1 font-semibold text-[#075e5a]">{priceRuleLabel}</div>
          {scopeLabel ? (
            <div className="mt-1 rounded-md bg-white px-2 py-1 font-semibold text-[#26334d]">
              适用范围：{scopeLabel}
            </div>
          ) : null}
        </div>
      ) : null}

      {promotionProducts.length ? (
        <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-700">
          <div className="mb-1 font-medium text-gray-950">待报名商品与实时条件快照</div>
          {promotionProducts.map((product, index) => {
            const item = asRecord(product);
            const productLabel = String(item.offerId ?? item.productId ?? "-");
            return (
              <div key={`${String(item.productId)}-${index}`} className="grid gap-2 py-1 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
                <span className="break-all" title={String(item.name ?? "")}>
                  {productLabel}{item.categoryKey ? ` · ${String(item.categoryKey)}` : ""}
                </span>
                <span>当前价 {String(item.currentPrice ?? "-")}</span>
                <span>活动价 {String(item.actionPrice ?? "-")}</span>
                <span>库存 {String(item.stock ?? "-")}</span>
                <span>{String(item.name ?? "").slice(0, 24)}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {editableSuggestions.length ? (
        <div className="mt-3 space-y-2">
          {editableSuggestions.map((suggestion, index) => {
            const item = asRecord(suggestion);
            return (
              <div key={index} className="border-l-4 border-[#18a7a0] bg-[#effcf9] p-3 text-sm">
                <div className="mb-1 flex flex-wrap gap-2">
                  <Badge tone="blue">{fieldLabel(item.field)}</Badge>
                  <Badge tone="gray">{String(item.sourceTag ?? "建议")}</Badge>
                </div>
                <div className="text-gray-700">{String(item.reasonZh ?? "")}</div>
                {canEditContentDraft ? (
                  <textarea
                    value={String(item.suggestedRu ?? "")}
                    onChange={(event) => {
                      const next = event.target.value;
                      setEditableSuggestions((current) => current.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, suggestedRu: next } : entry,
                      ));
                    }}
                    className="mt-2 min-h-24 w-full rounded-lg border border-[#bfe7e2] bg-white p-2 text-sm text-gray-950 outline-none focus:border-[#18a7a0] focus:ring-2 focus:ring-[#dff7f4]"
                  />
                ) : (
                  <div className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-gray-950">
                    {String(item.suggestedRu ?? "")}
                  </div>
                )}
              </div>
            );
          })}
          {canEditContentDraft ? (
            <>
              <div className="text-xs text-gray-500">确认执行会使用你当前编辑后的标题/描述；关键词建议仅保存展示，不直接写入 Ozon。</div>
              {editValidation && !editValidation.success ? (
                <div role="alert" className="text-xs font-medium text-red-600">{editValidation.error.message}</div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {isCompetitorBatch ? (
        <div className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-700">
          <div className="mb-2 font-bold text-gray-950">确认后将写入的属性（{attributeChanges.length}项）</div>
          {attributeChanges.length ? (
            <div className="max-h-72 divide-y divide-gray-200 overflow-y-auto border border-gray-200 bg-white">
              {attributeChanges.map((change, index) => (
                <div key={`${change.offerId}-${change.attributeName}-${index}`} className="grid gap-1 p-2 sm:grid-cols-[140px_1fr_1fr]">
                  <span className="break-all font-semibold text-gray-950">{change.offerId}</span>
                  <span>{change.attributeName}{change.required ? "（必填）" : ""}</span>
                  <span className="font-semibold text-[#075e5a]">写入：{change.suggestedValue}</span>
                  {change.reasonZh ? <span className="sm:col-span-2 sm:col-start-2">{change.reasonZh}</span> : null}
                  {change.evidenceUrl ? (
                    <a className="text-blue-700 underline sm:col-start-3" href={change.evidenceUrl} target="_blank" rel="noreferrer">
                      查看竞品证据
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="border-l-4 border-red-500 bg-red-50 p-2 text-red-800">修改明细不完整，已禁止执行。</div>
          )}
        </div>
      ) : null}

      {promotionRejected.length ? (
        <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-700">
          <div className="mb-1 font-medium text-gray-950">未纳入报名的商品</div>
          {promotionRejected.map((product, index) => {
            const item = asRecord(product);
            return (
              <div key={`${String(item.productId)}-${index}`} className="grid grid-cols-[1fr_2fr] gap-2 py-1">
                <span>商品 {String(item.productId ?? "-")}</span>
                <span>{String(item.reason ?? "-")}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="success"
          disabled={
            action.status !== "PENDING_APPROVAL" ||
            (isCompetitorBatch && !attributeChanges.length) ||
            Boolean(editValidation && !editValidation.success)
          }
          onClick={() => {
            if (
              isCompetitorBatch &&
              !window.confirm(`将真实修改 ${attributeChanges.length} 项 Ozon 商品属性，是否继续？`)
            ) {
              return;
            }
            if (
              action.type === "PROMOTION_ENROLLMENT" &&
              !window.confirm("活动报名会真实修改 Ozon 活动商品。确认继续执行？")
            ) {
              return;
            }
            onCommand(action.id, "confirm-execute", {
              expectedVersion: action.updatedAt,
              expectedStoreId: action.storeId,
              ...(canEditContentDraft ? { suggestions: executableEdits } : {}),
            });
          }}
          title="确认并执行"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          确认并执行
        </Button>
        <Button
          variant="outline"
          disabled={!["PENDING_APPROVAL", "RECOMMENDED"].includes(action.status)}
          onClick={() => onCommand(action.id, "reject", {
            expectedVersion: action.updatedAt,
            expectedStoreId: action.storeId,
          })}
          title="拒绝"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          拒绝
        </Button>
        <Button
          variant="secondary"
          disabled={action.status !== "APPROVED"}
          onClick={() => onCommand(action.id, "execute")}
          title="执行"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          执行
        </Button>
      </div>
    </section>
  );
}

function SessionSidebar({
  sessions,
  selectedSessionId,
  running,
  onSelect,
  onNewChat,
  onArchive,
}: {
  sessions: SessionOption[];
  selectedSessionId: string;
  running: boolean;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onArchive: (sessionId: string) => void;
}) {
  const [menu, setMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  function openMenu(sessionId: string, x: number, y: number) {
    const bounds = asideRef.current?.getBoundingClientRect();
    const localX = bounds ? x - bounds.left : x;
    const localY = bounds ? y - bounds.top : y;
    setMenu({
      sessionId,
      x: Math.max(8, Math.min(localX, (bounds?.width ?? window.innerWidth) - 152)),
      y: Math.max(8, Math.min(localY, (bounds?.height ?? window.innerHeight) - 56)),
    });
  }

  return (
    <aside ref={asideRef} className="relative hidden h-full w-64 shrink-0 flex-col rounded-2xl border border-white bg-white/90 p-3 shadow-[0_14px_40px_rgba(45,78,128,0.10)] md:flex">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-950">历史对话</div>
        <Button
          type="button"
          variant="outline"
          onClick={onNewChat}
          disabled={running}
          title="新对话"
          className="h-8 px-2"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          新对话
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        <button
          type="button"
          onClick={onNewChat}
          disabled={running}
          className={cn(
            "w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-all",
            selectedSessionId === "new"
              ? "border-[#bfd4ff] bg-[#eaf1ff] text-[#245fcf] shadow-[0_6px_16px_rgba(52,120,246,0.10)]"
              : "border-transparent bg-white/70 text-gray-700 hover:border-[#dce8f5] hover:bg-white",
          )}
        >
          <div className="truncate font-medium">新对话</div>
          <div className="mt-1 text-xs text-gray-500">开始一个独立上下文</div>
        </button>

        {sessions.map((session) => (
          <div
            key={session.id}
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(session.id, event.clientX, event.clientY);
            }}
            className={cn(
              "group flex w-full items-center rounded-xl border text-sm transition-all",
              selectedSessionId === session.id
                ? "border-[#bfd4ff] bg-[#eaf1ff] text-[#245fcf] shadow-[0_6px_16px_rgba(52,120,246,0.10)]"
                : "border-transparent bg-white/70 text-gray-700 hover:border-[#dce8f5] hover:bg-white",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(session.id)}
              disabled={running}
              className="min-w-0 flex-1 px-3 py-2.5 text-left"
            >
              <div className="truncate font-medium">{session.title ?? session.id}</div>
              <div className="mt-1 truncate text-xs text-gray-500">
                {formatTime(session.updatedAt) ?? session.updatedAt}
              </div>
            </button>
            <button
              type="button"
              disabled={running}
              aria-label={`管理对话：${session.title ?? session.id}`}
              title="更多"
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                openMenu(session.id, rect.right - 140, rect.bottom + 4);
              }}
              className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-white hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {menu ? (
        <div
          role="menu"
          className="absolute z-[100] w-36 rounded-lg border border-gray-200 bg-white p-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onArchive(menu.sessionId);
              setMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            删除对话
          </button>
        </div>
      ) : null}
    </aside>
  );
}

export function ContentAgentChat({
  stores,
  sessions,
  initialActions,
  agentConfig,
}: {
  stores: StoreOption[];
  sessions: SessionOption[];
  initialActions: ContentAgentActionView[];
  agentConfig: AgentConfig;
}) {
  const defaultStoreId = stores.find((store) => store.isDefault)?.id ?? stores[0]?.id ?? "";
  const initialSessionId = initialContentAgentSessionId(sessions);
  const opensExistingSession = initialSessionId !== "new";
  const [selectedStoreId, setSelectedStoreId] = useState(defaultStoreId);
  const [selectedSessionId, setSelectedSessionId] = useState(initialSessionId);
  const [sessionList, setSessionList] = useState(sessions);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [runningTrace, setRunningTrace] = useState<AgentTimelineStep[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(opensExistingSession);
  const scrollRef = useRef<HTMLDivElement>(null);

  const introMessage = useMemo(
    () => introMessageFor(agentConfig),
    [agentConfig.configured, agentConfig.message],
  );
  const pendingInitialActions = useMemo(
    () =>
      initialActions
        .filter((action) => ["PENDING_APPROVAL", "APPROVED"].includes(action.status))
        .slice(0, 3),
    [initialActions],
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    opensExistingSession
      ? []
      : [
          introMessageFor(agentConfig),
          ...(pendingInitialActions.length
            ? [
                {
                  id: "initial-actions",
                  role: "assistant" as const,
                  content: "这里有最近还没处理完的 Agent 动作。",
                  actions: pendingInitialActions,
                },
              ]
            : []),
        ],
  );
  const canSubmit = agentConfig.configured && stores.length > 0 && !loadingHistory;
  const inputStatus = !agentConfig.configured
    ? "模型未配置，不能发送"
    : !stores.length
      ? "未连接店铺，不能发送"
      : loadingHistory
        ? "正在加载历史，稍后发送"
        : running
          ? "Agent 正在处理"
          : "已连接，可以发送";

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "end" });
  }, [messages, running, loadingHistory]);

  useEffect(() => {
    if (selectedSessionId === "new") {
      setLoadingHistory(false);
      setMessages([introMessage]);
      return;
    }

    let cancelled = false;
    setLoadingHistory(true);
    setMessages([]);
    getJson(`/api/v1/agent/content/sessions/${selectedSessionId}/messages`)
      .then((data) => {
        if (cancelled) return;
        const loadedMessages = Array.isArray(data.messages)
          ? data.messages.map((message: PersistedChatMessage) => mapPersistedChatMessage(message))
          : [];
        setMessages(loadedMessages.length ? loadedMessages : [introMessage]);
        if (data.session) {
          setSessionList((current) => upsertSession(current, data.session));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setMessages([
          introMessage,
          {
            id: `history-error-${Date.now()}`,
            role: "assistant",
            content: err instanceof Error ? err.message : String(err),
          },
        ]);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, introMessage]);

  function startNewChat() {
    setSelectedSessionId("new");
    setPrompt("");
    setLoadingHistory(false);
    setMessages([introMessage]);
  }

  async function archiveSession(sessionId: string) {
    if (running || !window.confirm("删除这条历史对话？")) return;
    try {
      await deleteJson(`/api/v1/agent/content/sessions/${sessionId}`);
      const next = sessionsAfterArchive(sessionList, sessionId, selectedSessionId);
      setSessionList(next.sessions);
      if (next.selectedSessionId !== selectedSessionId) {
        setSelectedSessionId(next.selectedSessionId);
        setPrompt("");
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `archive-error-${Date.now()}`,
          role: "assistant",
          content: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
  }

  async function sendPrompt(value: string) {
    const content = value.trim();
    if (!content || running || loadingHistory) return;
    const requestSessionId = selectedSessionId;

    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content },
    ]);
    setPrompt("");
    setRunningTrace(buildPendingAgentExecutionTrace(content));
    setRunning(true);

    try {
      const started = await postJson(
        `/api/v1/agent/content/sessions/${requestSessionId}/messages/start`,
        {
          prompt: content,
          storeId: selectedStoreId || null,
        },
      );
      if (Array.isArray(started.executionTrace)) {
        setRunningTrace(started.executionTrace);
      }
      const updatedAt = new Date().toISOString();
      setSessionList((current) =>
        upsertSession(current, {
          id: started.sessionId,
          title:
            current.find((session) => session.id === started.sessionId)?.title ??
            sessionTitleFromPrompt(content),
          status:
            current.find((session) => session.id === started.sessionId)?.status ?? "OPEN",
          updatedAt,
        }),
      );
      if (requestSessionId !== started.sessionId) {
        setSelectedSessionId(started.sessionId);
      }

      const data = await pollAgentRunTrace(started.runId, setRunningTrace);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${started.runId}`,
          role: "assistant",
          content: data.status === "failed" ? data.error ?? "Agent 执行失败" : data.output,
          requestPrompt: content,
          actions: data.actions,
          dataSources: data.dataSources,
          plan: data.plan,
          executionTrace: data.executionTrace,
        },
      ]);
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setRunning(false);
      setRunningTrace([]);
    }
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendPrompt(prompt);
  }

  async function updateAction(actionId: string, command: "confirm-execute" | "reject" | "execute", payload: unknown = {}) {
    try {
      if (command === "confirm-execute") {
        const latest = await getJson(`/api/v1/agent/actions/${actionId}`);
        if (latest.action?.status !== "PENDING_APPROVAL") {
          setMessages((current) => [
            ...replaceAction(current, latest.action),
            {
              id: `assistant-action-stale-${Date.now()}`,
              role: "assistant",
              content: "这个任务已经处理过，我已刷新当前状态。",
            },
          ]);
          return latest.action?.status === "EXECUTED";
        }
      }
      const data = await postJson(`/api/v1/agent/actions/${actionId}/${command}`, payload);
      setMessages((current) => replaceAction(current, data.action));
      return command === "reject"
        ? data.action?.status === "REJECTED"
        : data.queued === true || data.action?.status === "EXECUTED";
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-action-error-${Date.now()}`,
          role: "assistant",
          content: err instanceof Error ? err.message : String(err),
        },
      ]);
      return false;
    }
  }

  return (
    <div className="flex h-[calc(100vh-136px)] w-full gap-4">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white bg-white/45 shadow-[0_14px_40px_rgba(45,78,128,0.08)]">
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-[#e3ebf5] bg-white/65 px-4 py-2 md:px-5">
          <select
            aria-label="历史对话"
            value={selectedSessionId}
            onChange={(event) => {
              if (event.target.value === "new") startNewChat();
              else setSelectedSessionId(event.target.value);
            }}
            disabled={running}
            className="h-9 min-w-0 flex-1 rounded-xl border border-[#d8e4f2] bg-white px-3 text-sm text-[#52627b] shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 md:hidden"
          >
            <option value="new">新对话</option>
            {sessionList.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title ?? session.id}
              </option>
            ))}
          </select>
          {selectedSessionId !== "new" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void archiveSession(selectedSessionId)}
              disabled={running}
              title="删除当前对话"
              className="h-9 w-9 shrink-0 px-0 md:hidden"
            >
              <Trash2 className="h-4 w-4 text-red-600" aria-hidden="true" />
              <span className="sr-only">删除当前对话</span>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={startNewChat}
            disabled={running}
            title="新对话"
            className="md:hidden"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            新对话
          </Button>
          {stores.length > 1 ? (
            <div className="w-48">
              <Select value={selectedStoreId} onChange={setSelectedStoreId}>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                    {store.isDefault ? " / 默认" : ""}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>

        {selectedSessionId === "new" && !loadingHistory && shouldShowCommandDeck(messages) ? (
          <AgentCommandDeck
            disabled={!canSubmit || running}
            onRun={(value) => void sendPrompt(value)}
          />
        ) : null}

        {!agentConfig.configured ? (
          <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <div className="font-semibold">模型未配置，运营 Agent 暂时不能运行</div>
                <div>{agentConfig.message}</div>
                <div className="mt-1 text-xs">
                  缺少：{agentConfig.missing.join(", ")}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(240,247,255,0.75),rgba(248,251,255,0.35))] px-4 py-4 pr-3 md:px-5">
          <div className="w-full space-y-4 pb-4">
            {messages.map((message) => {
              const hasReport = message.dataSources?.some((source) =>
                ["diagnose_ozon_store", "analyze_ozon_competitors"].includes(source.toolName),
              );
              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div className={cn("min-w-0", hasReport || message.actions?.length ? "w-full" : "max-w-[94%]")}>
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-3 text-sm leading-6",
                        message.role === "user"
                          ? "rounded-br-md bg-[#3478f6] text-white shadow-[0_10px_24px_rgba(52,120,246,0.18)]"
                          : "rounded-bl-md border border-white bg-white text-[#35415a] shadow-[0_10px_28px_rgba(49,78,122,0.09)]",
                      )}
                    >
                      <div className="whitespace-pre-wrap break-words">{message.content}</div>
                      {message.role === "assistant" ? (
                        <AgentInsightPanel
                          sources={message.dataSources}
                          requestPrompt={message.requestPrompt}
                          actions={message.actions}
                          onRun={(nextPrompt) => void sendPrompt(nextPrompt)}
                        />
                      ) : null}
                    </div>
                    {message.actions?.some((action) => action.type === "CONTENT_DRAFT") ? (
                      <ContentDraftGroup
                        actions={message.actions.filter((action) => action.type === "CONTENT_DRAFT")}
                        onCommand={updateAction}
                      />
                    ) : null}
                    {message.actions?.filter((action) => action.type !== "CONTENT_DRAFT").map((action) => (
                      <ActionBubble key={action.id} action={action} onCommand={updateAction} />
                    ))}
                  </div>
                </div>
              );
            })}
            {loadingHistory ? (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-xl border border-[#f4dbc9] bg-[#fff7f1] px-4 py-3 text-sm font-semibold text-[#8d4d25] shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  正在加载历史
                </div>
              </div>
            ) : null}
            {running ? (
              <div className="flex justify-start">
                <div className="inline-flex max-w-[94%] items-center gap-2 rounded-2xl rounded-bl-md border border-white bg-white px-4 py-3 text-sm font-semibold leading-6 text-[#6c55a6] shadow-[0_10px_28px_rgba(49,78,122,0.09)]">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                  <span>{runningAgentStatus(runningTrace)}</span>
                </div>
              </div>
            ) : null}
            <div ref={scrollRef} />
          </div>
        </div>

        <form onSubmit={submitPrompt} className="border-t border-[#e3ebf5] bg-white/75 p-3 md:px-5">
          <div className="mb-2 text-xs font-medium text-[#667085]">{inputStatus}</div>
          <div className="flex w-full items-end gap-2 rounded-2xl border border-[#d8e4f2] bg-white p-2 shadow-[0_10px_30px_rgba(46,80,132,0.10)] focus-within:border-[#9bbcff] focus-within:ring-4 focus-within:ring-[#3478f6]/10">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (shouldSubmitChatKey({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                })) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="输入运营任务，例如：诊断低分商品并生成优化方案"
              disabled={!canSubmit}
              className="min-h-11 max-h-40 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-gray-900 outline-none placeholder:text-[#9aa6ba]"
              rows={1}
            />
            <Button
              type="submit"
              disabled={running || !canSubmit || !prompt.trim()}
              className="h-10 w-10 shrink-0 rounded-xl border-[#3478f6] bg-[#3478f6] px-0 hover:bg-[#2868df]"
              title="发送"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="sr-only">发送</span>
            </Button>
          </div>
        </form>
      </main>

      <SessionSidebar
        sessions={sessionList}
        selectedSessionId={selectedSessionId}
        running={running}
        onSelect={setSelectedSessionId}
        onNewChat={startNewChat}
        onArchive={(sessionId) => void archiveSession(sessionId)}
      />
    </div>
  );
}
