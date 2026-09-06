"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Database,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { Badge, Button, Select, cn } from "./ui";

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
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type ContentAgentDataSourceView = {
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
  found?: boolean | null;
  stock?: number | null;
  actionCount?: number | null;
  candidateCount?: number | null;
  competitorReportCount?: number | null;
  financeDataAvailable?: boolean | null;
  error?: string | null;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  actions?: ContentAgentActionView[];
  dataSources?: ContentAgentDataSourceView[];
};

type PersistedChatMessage = ChatMessage & {
  createdAt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function suggestionsFromPayload(payload: unknown) {
  const suggestions = asRecord(payload).suggestions;
  return Array.isArray(suggestions) ? suggestions.slice(0, 6) : [];
}

function toneForStatus(status: string) {
  if (status === "APPROVED") return "green";
  if (status === "REJECTED" || status === "FAILED" || status === "BLOCKED") return "red";
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

function formatTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function sourceSummary(source: ContentAgentDataSourceView) {
  const parts = [source.label];
  if (source.storeName) parts.push(source.storeName);
  if (typeof source.productCount === "number") parts.push(`商品 ${source.productCount}`);
  if (typeof source.visibleProductCount === "number") parts.push(`可见 ${source.visibleProductCount}`);
  if (typeof source.totalStock === "number") parts.push(`库存 ${source.totalStock}`);
  if (source.offerId) parts.push(`offerId ${source.offerId}`);
  if (source.productId) parts.push(`productId ${source.productId}`);
  if (typeof source.stock === "number") parts.push(`库存 ${source.stock}`);
  if (typeof source.actionCount === "number") parts.push(`活动 ${source.actionCount}`);
  if (typeof source.candidateCount === "number") parts.push(`候选 ${source.candidateCount}`);
  if (typeof source.competitorReportCount === "number") parts.push(`分析商品 ${source.competitorReportCount}`);
  if (typeof source.financeDataAvailable === "boolean") {
    parts.push(source.financeDataAvailable ? "含财务流水" : "财务流水暂不可用");
  }
  const syncedAt = formatTime(source.syncedAt ?? source.at);
  if (syncedAt) parts.push(`同步 ${syncedAt}`);
  if (source.error) parts.push(`错误 ${source.error}`);
  return parts.join(" · ");
}

function DataSources({ sources }: { sources?: ContentAgentDataSourceView[] }) {
  if (!sources?.length) return null;
  return (
    <div className="mt-3 space-y-1 border-t border-gray-100 pt-2">
      {sources.map((source, index) => (
        <div
          key={`${source.toolName}-${source.at}-${index}`}
          className={cn(
            "flex items-start gap-2 text-xs leading-5",
            source.status === "error" ? "text-red-600" : "text-gray-500",
          )}
        >
          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="break-words">{sourceSummary(source)}</span>
        </div>
      ))}
    </div>
  );
}

function introMessageFor(agentConfig: AgentConfig): ChatMessage {
  return {
    id: "intro",
    role: "assistant",
    content: agentConfig.configured
      ? "你可以直接询问店铺诊断、竞品分析和 Ozon 活动。读取数据会调用真实工具；任何商品改动或活动报名都必须先生成等待人工确认的动作。"
      : agentConfig.message,
  };
}

function upsertSession(sessions: SessionOption[], session: SessionOption) {
  return [session, ...sessions.filter((item) => item.id !== session.id)].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
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
  onCommand: (actionId: string, command: "confirm-execute" | "reject" | "execute") => void;
}) {
  const suggestions = suggestionsFromPayload(action.payload);
  const payload = asRecord(action.payload);
  const ruleConditions = Array.isArray(asRecord(payload.rule).all)
    ? (asRecord(payload.rule).all as unknown[])
    : [];
  const promotionProducts = Array.isArray(payload.products)
    ? payload.products.slice(0, 20)
    : [];

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={toneForStatus(action.status)}>{action.status}</Badge>
        <Badge tone={toneForRisk(action.riskLevel)}>{action.riskLevel}</Badge>
        <span className="text-xs font-medium text-gray-500">{actionTypeLabel(action.type)}</span>
      </div>
      <div className="mt-2 text-sm font-semibold text-gray-950">{action.title}</div>
      <div className="mt-1 text-sm leading-6 text-gray-600">{action.rationale}</div>
      {actionPayloadSummary(action) ? (
        <div className="mt-2 text-xs text-gray-500">{actionPayloadSummary(action)}</div>
      ) : null}
      {action.error ? <div className="mt-2 text-xs text-red-600">{action.error}</div> : null}

      {ruleConditions.length ? (
        <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-700">
          <div className="mb-1 font-medium text-gray-950">确认后生效的规则</div>
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

      {promotionProducts.length ? (
        <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-700">
          <div className="mb-1 font-medium text-gray-950">待报名商品与实时条件快照</div>
          {promotionProducts.map((product, index) => {
            const item = asRecord(product);
            return (
              <div key={`${String(item.productId)}-${index}`} className="grid grid-cols-4 gap-2 py-1">
                <span>商品 {String(item.productId ?? "-")}</span>
                <span>当前价 {String(item.currentPrice ?? "-")}</span>
                <span>活动价 {String(item.actionPrice ?? "-")}</span>
                <span>库存 {String(item.stock ?? "-")}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {suggestions.length ? (
        <div className="mt-3 space-y-2">
          {suggestions.map((suggestion, index) => {
            const item = asRecord(suggestion);
            return (
              <div key={index} className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="mb-1 flex flex-wrap gap-2">
                  <Badge tone="blue">{fieldLabel(item.field)}</Badge>
                  <Badge tone="gray">{String(item.sourceTag ?? "建议")}</Badge>
                </div>
                <div className="text-gray-700">{String(item.reasonZh ?? "")}</div>
                <div className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-gray-950">
                  {String(item.suggestedRu ?? "")}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="success"
          disabled={action.status !== "PENDING_APPROVAL"}
          onClick={() => {
            if (
              action.type === "PROMOTION_ENROLLMENT" &&
              !window.confirm("活动报名会真实修改 Ozon 活动商品。确认继续执行？")
            ) {
              return;
            }
            onCommand(action.id, "confirm-execute");
          }}
          title="确认并执行"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          确认并执行
        </Button>
        <Button
          variant="outline"
          disabled={!["PENDING_APPROVAL", "RECOMMENDED", "BLOCKED"].includes(action.status)}
          onClick={() => onCommand(action.id, "reject")}
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
    </div>
  );
}

function SessionSidebar({
  sessions,
  selectedSessionId,
  running,
  onSelect,
  onNewChat,
}: {
  sessions: SessionOption[];
  selectedSessionId: string;
  running: boolean;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
}) {
  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col border-l border-gray-200 pl-4 lg:flex">
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
            "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
            selectedSessionId === "new"
              ? "border-blue-300 bg-blue-50 text-blue-950"
              : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
          )}
        >
          <div className="truncate font-medium">新对话</div>
          <div className="mt-1 text-xs text-gray-500">开始一个独立上下文</div>
        </button>

        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelect(session.id)}
            disabled={running}
            className={cn(
              "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
              selectedSessionId === session.id
                ? "border-blue-300 bg-blue-50 text-blue-950"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
            )}
          >
            <div className="truncate font-medium">{session.title ?? session.id}</div>
            <div className="mt-1 truncate text-xs text-gray-500">
              {formatTime(session.updatedAt) ?? session.updatedAt}
            </div>
          </button>
        ))}
      </div>
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
  const [selectedStoreId, setSelectedStoreId] = useState(defaultStoreId);
  const [selectedSessionId, setSelectedSessionId] = useState("new");
  const [sessionList, setSessionList] = useState(sessions);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
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
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
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
  ]);
  const canSubmit = agentConfig.configured && stores.length > 0 && !loadingHistory;

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "end" });
  }, [messages, running, loadingHistory]);

  useEffect(() => {
    if (selectedSessionId === "new") {
      setMessages([introMessage]);
      return;
    }

    let cancelled = false;
    setLoadingHistory(true);
    getJson(`/api/v1/agent/content/sessions/${selectedSessionId}/messages`)
      .then((data) => {
        if (cancelled) return;
        const loadedMessages = Array.isArray(data.messages)
          ? data.messages.map((message: PersistedChatMessage) => ({
              id: message.id,
              role: message.role,
              content: message.content,
              actions: message.actions,
              dataSources: message.dataSources,
            }))
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
    setMessages([introMessage]);
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || running || loadingHistory) return;
    const requestSessionId = selectedSessionId;

    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content },
    ]);
    setPrompt("");
    setRunning(true);

    try {
      const data = await postJson(
        `/api/v1/agent/content/sessions/${requestSessionId}/messages`,
        {
          prompt: content,
          storeId: selectedStoreId || null,
        },
      );
      const updatedAt = new Date().toISOString();
      setSessionList((current) =>
        upsertSession(current, {
          id: data.sessionId,
          title:
            current.find((session) => session.id === data.sessionId)?.title ??
            sessionTitleFromPrompt(content),
          status:
            current.find((session) => session.id === data.sessionId)?.status ?? "OPEN",
          updatedAt,
        }),
      );
      if (requestSessionId !== data.sessionId) {
        setSelectedSessionId(data.sessionId);
      }
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${data.runId}`,
          role: "assistant",
          content: data.output,
          actions: data.actions,
          dataSources: data.dataSources,
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
    }
  }

  async function updateAction(actionId: string, command: "confirm-execute" | "reject" | "execute") {
    try {
      const data = await postJson(`/api/v1/agent/actions/${actionId}/${command}`);
      setMessages((current) => replaceAction(current, data.action));
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-action-error-${Date.now()}`,
          role: "assistant",
          content: err instanceof Error ? err.message : String(err),
        },
      ]);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-140px)] max-w-6xl gap-4">
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-gray-200 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-950">
                Ozon 运营 Agent
              </div>
              <div className="truncate text-xs text-gray-500">
                店铺诊断 + 竞品分析 + 活动报名
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={startNewChat}
              disabled={running}
              title="新对话"
              className="lg:hidden"
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
            <Badge tone="green">
              <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
              改动需确认
            </Badge>
            <Badge tone="blue">读取直接执行</Badge>
          </div>
        </div>

        {!agentConfig.configured ? (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
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

        <div className="flex-1 overflow-y-auto pr-1">
          <div className="space-y-4 pb-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[88%] rounded-lg px-4 py-3 text-sm leading-6 shadow-sm",
                    message.role === "user"
                      ? "bg-blue-600 text-white"
                      : "border border-gray-200 bg-white text-gray-800",
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  {message.role === "assistant" ? (
                    <DataSources sources={message.dataSources} />
                  ) : null}
                  {message.actions?.map((action) => (
                    <ActionBubble
                      key={action.id}
                      action={action}
                      onCommand={updateAction}
                    />
                  ))}
                </div>
              </div>
            ))}
            {loadingHistory ? (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  正在加载历史
                </div>
              </div>
            ) : null}
            {running ? (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  正在处理
                </div>
              </div>
            ) : null}
            <div ref={scrollRef} />
          </div>
        </div>

        <form onSubmit={submitPrompt} className="border-t border-gray-200 pt-3">
          <div className="flex items-end gap-2 rounded-lg border border-gray-300 bg-white p-2 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="例如：自己店铺现在有多少商品？"
              disabled={!canSubmit}
              className="min-h-11 max-h-40 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400"
              rows={1}
            />
            <Button
              type="submit"
              disabled={running || !canSubmit || !prompt.trim()}
              className="h-10 w-10 shrink-0 px-0"
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
      />
    </div>
  );
}
