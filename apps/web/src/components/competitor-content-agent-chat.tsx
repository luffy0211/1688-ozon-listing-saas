"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Loader2, Send, ShieldCheck, X } from "lucide-react";
import { Badge, Button, cn } from "./ui";

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

type SourceProductOption = {
  id: string;
  offerId: string;
  title: string | null;
};

export type CompetitorChatActionView = {
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

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  actions?: CompetitorChatActionView[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function suggestionsFromPayload(payload: unknown) {
  const suggestions = asRecord(payload).suggestions;
  return Array.isArray(suggestions) ? suggestions.slice(0, 4) : [];
}

function toneForStatus(status: string) {
  if (status === "APPROVED" || status === "EXECUTED") return "green";
  if (status === "REJECTED" || status === "FAILED" || status === "BLOCKED") {
    return "red";
  }
  if (status === "PENDING_APPROVAL") return "amber";
  return "blue";
}

function toneForRisk(risk: string) {
  if (risk === "HIGH") return "red";
  if (risk === "MEDIUM") return "amber";
  return "gray";
}

function actionLabel(type: string) {
  const labels: Record<string, string> = {
    UPDATE_PRICE: "改价",
    UPDATE_STOCK: "改库存",
    UPDATE_IMAGES: "改图片",
    UPDATE_ATTRIBUTES: "改属性",
    UPDATE_CATEGORY: "改类目",
    PUBLISH_DRAFT: "发布草稿",
    CONTENT_DRAFT: "内容优化",
    ARCHIVE_PRODUCT: "归档商品",
    UNARCHIVE_PRODUCT: "恢复商品",
    DELETE_PRODUCT: "删除商品",
    BULK_PRODUCT_UPDATE: "批量修改商品",
    RESTOCK_RECOMMENDATION: "补货建议",
    PROMO_RECOMMENDATION: "促销建议",
  };
  return labels[type] ?? type;
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

function replaceAction(
  messages: ChatMessage[],
  action: CompetitorChatActionView,
): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    actions: message.actions?.map((item) =>
      item.id === action.id ? action : item,
    ),
  }));
}

function ActionBubble({
  action,
  onCommand,
}: {
  action: CompetitorChatActionView;
  onCommand: (
    actionId: string,
    command: "approve" | "reject" | "execute",
    payload?: unknown,
  ) => void;
}) {
  const suggestions = suggestionsFromPayload(action.payload);

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={toneForStatus(action.status)}>{action.status}</Badge>
        <Badge tone={toneForRisk(action.riskLevel)}>{action.riskLevel}</Badge>
        <span className="text-xs font-medium text-gray-500">
          {actionLabel(action.type)}
        </span>
      </div>
      <div className="mt-2 text-sm font-semibold text-gray-950">{action.title}</div>
      <div className="mt-1 text-sm leading-6 text-gray-600">{action.rationale}</div>
      {action.offerId ? (
        <div className="mt-2 text-xs text-gray-500">offerId: {action.offerId}</div>
      ) : null}
      {action.error ? (
        <div className="mt-2 text-xs text-red-600">blocked: {action.error}</div>
      ) : null}

      {action.type === "CONTENT_DRAFT" && suggestions.length ? (
        <div className="mt-3 space-y-2">
          {suggestions.map((suggestion, index) => {
            const item = asRecord(suggestion);
            return (
              <div
                key={index}
                className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm"
              >
                <div className="mb-1 flex flex-wrap gap-2">
                  <Badge tone="blue">{fieldLabel(item.field)}</Badge>
                  <Badge tone="gray">{String(item.sourceTag ?? "建议")}</Badge>
                </div>
                <div className="text-gray-700">{String(item.reasonZh ?? "")}</div>
                <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-gray-950">
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
          onClick={() => onCommand(action.id, "approve", {
            expectedVersion: action.updatedAt,
            expectedStoreId: action.storeId,
          })}
          title="批准"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          批准
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
    </div>
  );
}

export function CompetitorContentAgentChat({
  stores,
  sourceProducts,
  sessions,
  initialActions,
}: {
  stores: StoreOption[];
  sourceProducts: SourceProductOption[];
  sessions: SessionOption[];
  initialActions: CompetitorChatActionView[];
}) {
  const defaultStoreId = stores.find((store) => store.isDefault)?.id ?? stores[0]?.id ?? "";
  const [selectedSessionId, setSelectedSessionId] = useState(sessions[0]?.id ?? "new");
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const pendingInitialActions = useMemo(
    () =>
      initialActions
        .filter((action) => ["PENDING_APPROVAL", "APPROVED"].includes(action.status))
        .slice(0, 3),
    [initialActions],
  );

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: "intro",
      role: "assistant",
      content:
        sourceProducts.length > 0
          ? "把自家商品 offerId 和 Ozon 竞品链接发给我。我会采集竞品商品信息，对比自家商品标题、关键词、描述和属性表达，然后生成需要人工确认的内容草稿。"
          : "先把自家商品导入商品池，或者在消息里提供当前商品标题、offerId 和 Ozon 竞品链接。我会优先分析竞品商品信息，不会直接执行未确认的改动。",
    },
    ...(pendingInitialActions.length
      ? [
          {
            id: "initial-actions",
            role: "assistant" as const,
            content: "这里有最近还没处理完的建议。",
            actions: pendingInitialActions,
          },
        ]
      : []),
  ]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "end" });
  }, [messages, running]);

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || running) return;

    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content },
    ]);
    setPrompt("");
    setRunning(true);

    try {
      const data = await postJson(
        `/api/v1/agent/sessions/${selectedSessionId}/messages`,
        {
          prompt: content,
          storeId: defaultStoreId || null,
        },
      );
      setSelectedSessionId(data.sessionId);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${data.runId}`,
          role: "assistant",
          content: data.output,
          actions: data.actions,
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

  async function updateAction(
    actionId: string,
    command: "approve" | "reject" | "execute",
    payload: unknown = {},
  ) {
    try {
      const data = await postJson(`/api/v1/agent/actions/${actionId}/${command}`, payload);
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
    <div className="mx-auto flex h-[calc(100vh-140px)] max-w-3xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white">
            <Bot className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-950">
              Ozon 竞品内容 Agent
            </div>
            <div className="truncate text-xs text-gray-500">
              {stores[0]?.name ?? "未连接店铺"} · 只在确认后执行
            </div>
          </div>
        </div>
        <Badge tone="green" className="shrink-0">
          <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
          人工确认
        </Badge>
      </div>

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
          {running ? (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                正在分析
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
            placeholder="例如：分析 offerId ABC123，对比 https://www.ozon.ru/product/..."
            className="min-h-11 max-h-40 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400"
            rows={1}
          />
          <Button
            type="submit"
            disabled={running || !stores.length || !prompt.trim()}
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
    </div>
  );
}
