"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  Check,
  ClipboardList,
  MessageSquare,
  RefreshCcw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, Select, cn } from "./ui";

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

export type AgentActionView = {
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

export function AgentWorkbench({
  stores,
  sourceProducts,
  sessions,
  initialActions,
}: {
  stores: StoreOption[];
  sourceProducts: SourceProductOption[];
  sessions: SessionOption[];
  initialActions: AgentActionView[];
}) {
  const [selectedStoreId, setSelectedStoreId] = useState(stores[0]?.id ?? "");
  const [selectedSourceProductId, setSelectedSourceProductId] = useState(sourceProducts[0]?.id ?? "");
  const [selectedSessionId, setSelectedSessionId] = useState("new");
  const [prompt, setPrompt] = useState(
    "分析这些竞品商品信息，对比我的商品标题、关键词和描述，给出本土化内容优化建议。",
  );
  const [competitorUrlsText, setCompetitorUrlsText] = useState("");
  const [refreshOzonData, setRefreshOzonData] = useState(true);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [actions, setActions] = useState(initialActions);
  const [error, setError] = useState("");

  const pendingCount = useMemo(
    () => actions.filter((item) => item.status === "PENDING_APPROVAL").length,
    [actions],
  );

  async function submitPrompt() {
    if (!prompt.trim()) return;
    setRunning(true);
    setError("");
    try {
      const data = await postJson(
        `/api/v1/agent/sessions/${selectedSessionId}/messages`,
        {
          prompt,
          storeId: selectedStoreId || null,
          sourceProductId: selectedSourceProductId || null,
          competitorUrls: competitorUrlsText
            .split(/\s+/)
            .map((url) => url.trim())
            .filter(Boolean),
          refreshOzonData,
        },
      );
      setSelectedSessionId(data.sessionId);
      setOutput(data.output);
      setActions((current) => [...data.actions, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function updateAction(actionId: string, command: "approve" | "reject" | "execute") {
    try {
      const data = await postJson(`/api/v1/agent/actions/${actionId}/${command}`);
      setActions((current) =>
        current.map((item) => (item.id === actionId ? data.action : item)),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-gray-950">Ozon 运营 Agent</div>
                <div className="text-sm text-gray-500">
                  {pendingCount} 个待审批动作
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/agent/content"
                className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                竞品内容聊天
              </Link>
              <Badge tone="green">
                <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
                HITL
              </Badge>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Select label="Ozon 店铺" value={selectedStoreId} onChange={setSelectedStoreId}>
              {stores.length ? (
                stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}{store.isDefault ? " / 默认" : ""}
                  </option>
                ))
              ) : (
                <option value="">暂无店铺</option>
              )}
            </Select>
            <Select label="会话" value={selectedSessionId} onChange={setSelectedSessionId}>
              <option value="new">新会话</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title ?? session.id}
                </option>
              ))}
            </Select>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Select label="自家商品" value={selectedSourceProductId} onChange={setSelectedSourceProductId}>
              {sourceProducts.length ? (
                sourceProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.title ?? product.offerId}
                  </option>
                ))
              ) : (
                <option value="">暂无商品池商品</option>
              )}
            </Select>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                竞品 Ozon URL
              </span>
              <textarea
                value={competitorUrlsText}
                onChange={(event) => setCompetitorUrlsText(event.target.value)}
                placeholder="每行一个商品或店铺 URL"
                className="min-h-20 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              运营指令
            </span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="min-h-32 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={refreshOzonData}
                onChange={(event) => setRefreshOzonData(event.target.checked)}
                disabled
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              实时读取 Ozon 店铺数据
            </label>
            <Button
              onClick={submitPrompt}
              disabled={running || !stores.length || !prompt.trim()}
              className="w-full sm:w-auto"
            >
              {running ? (
                <RefreshCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              {running ? "运行中" : "运行 Agent"}
            </Button>
          </div>
          {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
        </Card>

        {output ? (
          <Card className="border-blue-200 bg-blue-50">
            <div className="mb-2 text-sm font-semibold text-blue-950">Agent 回复</div>
            <div className="whitespace-pre-wrap text-sm leading-6 text-blue-900">
              {output}
            </div>
          </Card>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-gray-500" aria-hidden="true" />
            <h2 className="text-base font-semibold text-gray-950">动作队列</h2>
          </div>
          {actions.length ? (
            actions.map((action) => (
              <Card key={action.id} className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneForStatus(action.status)}>{action.status}</Badge>
                      <Badge tone={toneForRisk(action.riskLevel)}>{action.riskLevel}</Badge>
                      <span className="text-xs font-medium text-gray-500">
                        {actionLabel(action.type)}
                      </span>
                    </div>
                    <div className="mt-2 font-semibold text-gray-950">{action.title}</div>
                    <div className="mt-1 text-sm leading-6 text-gray-600">
                      {action.rationale}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                      {action.offerId ? <span>offerId: {action.offerId}</span> : null}
                      {action.error ? <span>blocked: {action.error}</span> : null}
                    </div>
                    {action.type === "CONTENT_DRAFT" ? (
                      <div className="mt-3 space-y-2">
                        {suggestionsFromPayload(action.payload).map((suggestion, index) => {
                          const item = asRecord(suggestion);
                          return (
                            <div key={index} className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                              <div className="mb-1 flex flex-wrap gap-2">
                                <Badge tone="blue">{fieldLabel(item.field)}</Badge>
                                <Badge tone="gray">{String(item.sourceTag ?? "建议")}</Badge>
                              </div>
                              <div className="text-gray-700">{String(item.reasonZh ?? "")}</div>
                              <div className="mt-1 line-clamp-3 text-gray-950">{String(item.suggestedRu ?? "")}</div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className={cn(
                      "flex shrink-0 gap-2",
                      !["PENDING_APPROVAL", "APPROVED"].includes(action.status) && "opacity-50",
                    )}
                  >
                    <Button
                      variant="success"
                      disabled={action.status !== "PENDING_APPROVAL"}
                      onClick={() => updateAction(action.id, "approve")}
                      title="批准"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                      批准
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!["PENDING_APPROVAL", "RECOMMENDED", "BLOCKED"].includes(action.status)}
                      onClick={() => updateAction(action.id, "reject")}
                      title="拒绝"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                      拒绝
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={action.status !== "APPROVED"}
                      onClick={() => updateAction(action.id, "execute")}
                      title="执行"
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                      执行
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          ) : (
            <EmptyState title="暂无动作" description="运行 Agent 后会在这里出现建议和审批项。" />
          )}
        </div>
      </div>

      <Card className="h-fit">
        <div className="mb-4 text-sm font-semibold text-gray-950">最近会话</div>
        {sessions.length ? (
          <div className="space-y-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setSelectedSessionId(session.id)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  selectedSessionId === session.id
                    ? "border-blue-300 bg-blue-50 text-blue-950"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                )}
              >
                <div className="truncate font-medium">{session.title ?? session.id}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {new Date(session.updatedAt).toLocaleString("zh-CN")}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无会话" />
        )}
      </Card>
    </div>
  );
}
