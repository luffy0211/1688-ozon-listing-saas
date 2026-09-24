"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { validateContentDraftEdits } from "@/lib/agent/content-draft-edits";
import { Badge, Button, cn } from "./ui";

type DraftAction = {
  id: string;
  type: string;
  status: string;
  riskLevel: string;
  title: string;
  rationale: string;
  storeId: string | null;
  offerId: string | null;
  payload: unknown;
  error: string | null;
  updatedAt: string;
};

type DraftSuggestion = Record<string, unknown> & {
  field: string;
  current?: string | null;
  suggestedRu: string;
};

type DraftCommand = (
  actionId: string,
  command: "confirm-execute" | "reject" | "execute",
  payload?: unknown,
) => Promise<boolean>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function suggestionsFromAction(action: DraftAction): DraftSuggestion[] {
  const suggestions = asRecord(action.payload).suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions.flatMap((value) => {
    const item = asRecord(value);
    const field = typeof item.field === "string" ? item.field : "";
    const suggestedRu = typeof item.suggestedRu === "string" ? item.suggestedRu : "";
    if (!field) return [];
    return [{ ...item, field, suggestedRu } as DraftSuggestion];
  });
}

export function initialSelectedDraftIds(
  actions: Array<Pick<DraftAction, "id" | "type" | "status">>,
) {
  return actions
    .filter((action) => action.type === "CONTENT_DRAFT" && action.status === "PENDING_APPROVAL")
    .map((action) => action.id);
}

export function contentDraftStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING_APPROVAL: "待确认",
    APPROVED: "待执行",
    EXECUTED: "已执行",
    REJECTED: "已拒绝",
    FAILED: "执行失败",
    BLOCKED: "处理中",
  };
  return labels[status] ?? status;
}

export function draftSuggestionGroups(value: unknown) {
  const suggestions = Array.isArray(value) ? value.map(asRecord) : [];
  return {
    executable: suggestions.filter((item) => ["title", "description"].includes(String(item.field ?? ""))),
    reference: suggestions.filter((item) => !["title", "description"].includes(String(item.field ?? ""))),
  };
}

export function validateDraftSuggestions(value: unknown) {
  const { executable } = draftSuggestionGroups(value);
  const validation = validateContentDraftEdits(executable);
  return validation.success ? null : validation.error.message;
}

function fieldLabel(field: unknown) {
  return ({ title: "标题", description: "描述", keywords: "关键词" } as Record<string, string>)[
    String(field ?? "")
  ] ?? String(field ?? "内容");
}

function riskLabel(risk: string) {
  return ({ LOW: "低风险", MEDIUM: "中风险", HIGH: "高风险" } as Record<string, string>)[risk] ?? risk;
}

function statusTone(status: string) {
  if (status === "EXECUTED") return "green";
  if (["FAILED", "REJECTED"].includes(status)) return "red";
  if (["PENDING_APPROVAL", "APPROVED", "BLOCKED"].includes(status)) return "amber";
  return "gray";
}

function riskTone(risk: string) {
  if (risk === "HIGH") return "red";
  if (risk === "MEDIUM") return "amber";
  return "gray";
}

function draftProductLabel(action: DraftAction) {
  const payload = asRecord(action.payload);
  const product = asRecord(payload.product);
  const current = asRecord(payload.current);
  const name = [product.name, product.title, current.name, current.title]
    .find((value) => typeof value === "string" && value.trim());
  return typeof name === "string" ? name : action.title;
}

function executableFieldLabels(action: DraftAction) {
  const { executable } = draftSuggestionGroups(suggestionsFromAction(action));
  return executable.map((item) => fieldLabel(item.field));
}

export function ContentDraftGroup({
  actions,
  onCommand,
}: {
  actions: DraftAction[];
  onCommand: DraftCommand;
}) {
  const pendingIds = useMemo(() => initialSelectedDraftIds(actions), [actions]);
  const [selectedIds, setSelectedIds] = useState(() => new Set(pendingIds));
  const [activeId, setActiveId] = useState(actions[0]?.id ?? "");
  const [edits, setEdits] = useState<Record<string, DraftSuggestion[]>>(() =>
    Object.fromEntries(actions.map((action) => [action.id, suggestionsFromAction(action)])),
  );
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const activeAction = actions.find((action) => action.id === activeId) ?? actions[0];
  if (!activeAction) return null;

  const selectedPending = actions.filter(
    (action) => action.status === "PENDING_APPROVAL" && selectedIds.has(action.id),
  );
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedIds.has(id));

  function setSuggestion(actionId: string, index: number, suggestedRu: string) {
    setEdits((current) => ({
      ...current,
      [actionId]: (current[actionId] ?? []).map((item, itemIndex) =>
        itemIndex === index ? { ...item, suggestedRu } : item,
      ),
    }));
    setErrors((current) => ({ ...current, [actionId]: "" }));
  }

  function toggleSelected(actionId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return next;
    });
  }

  async function runAction(action: DraftAction) {
    const actionEdits = edits[action.id] ?? suggestionsFromAction(action);
    if (action.status === "PENDING_APPROVAL") {
      const validationError = validateDraftSuggestions(actionEdits);
      if (validationError) {
        setErrors((current) => ({ ...current, [action.id]: validationError }));
        return false;
      }
    }
    setBusyIds((current) => new Set(current).add(action.id));
    setErrors((current) => ({ ...current, [action.id]: "" }));
    try {
      const command = action.status === "APPROVED" ? "execute" : "confirm-execute";
      const succeeded = await onCommand(
        action.id,
        command,
        action.status === "PENDING_APPROVAL"
          ? {
              expectedVersion: action.updatedAt,
              expectedStoreId: action.storeId,
              suggestions: draftSuggestionGroups(actionEdits).executable,
            }
          : undefined,
      );
      if (succeeded) {
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(action.id);
          return next;
        });
      } else {
        setErrors((current) => ({ ...current, [action.id]: "执行未完成，请查看该商品的失败原因" }));
      }
      return succeeded;
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(action.id);
        return next;
      });
    }
  }

  async function rejectAction(action: DraftAction) {
    setBusyIds((current) => new Set(current).add(action.id));
    try {
      const rejected = await onCommand(action.id, "reject", {
        expectedVersion: action.updatedAt,
        expectedStoreId: action.storeId,
      });
      if (rejected) {
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(action.id);
          return next;
        });
      }
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(action.id);
        return next;
      });
    }
  }

  async function runBatch() {
    if (!selectedPending.length) return;
    const validationErrors = selectedPending.flatMap((action) => {
      const error = validateDraftSuggestions(edits[action.id] ?? suggestionsFromAction(action));
      return error ? [{ id: action.id, error }] : [];
    });
    if (validationErrors.length) {
      setErrors((current) => ({
        ...current,
        ...Object.fromEntries(validationErrors.map((item) => [item.id, item.error])),
      }));
      setActiveId(validationErrors[0]!.id);
      return;
    }
    if (!window.confirm(`将真实修改 ${selectedPending.length} 个 Ozon 商品，是否继续？`)) return;

    setBatchProgress({ current: 0, total: selectedPending.length });
    for (let index = 0; index < selectedPending.length; index += 1) {
      setBatchProgress({ current: index + 1, total: selectedPending.length });
      await runAction(selectedPending[index]!);
    }
    setBatchProgress(null);
  }

  const activeSuggestions = edits[activeAction.id] ?? suggestionsFromAction(activeAction);
  const activeGroups = draftSuggestionGroups(activeSuggestions);
  const isActiveBusy = busyIds.has(activeAction.id);
  const canEdit = activeAction.status === "PENDING_APPROVAL" && !isActiveBusy;
  const validationError = errors[activeAction.id] || (canEdit ? validateDraftSuggestions(activeSuggestions) : null);

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-[#dce6f3] bg-white shadow-[0_8px_22px_rgba(49,78,122,0.07)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e3ebf5] bg-[#f8fbff] px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-[#17223d]">商品修改草案</h3>
          <p className="mt-0.5 text-xs text-[#667085]">{actions.length} 个商品 · 先核对修改前后内容，再执行</p>
        </div>
        {pendingIds.length ? (
          <Button
            variant="success"
            disabled={!selectedPending.length || Boolean(batchProgress)}
            onClick={() => void runBatch()}
          >
            {batchProgress ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            {batchProgress
              ? `正在执行 ${batchProgress.current}/${batchProgress.total}`
              : `执行已选 ${selectedPending.length} 项`}
          </Button>
        ) : null}
      </div>

      <div className="grid min-h-0 lg:grid-cols-[290px_minmax(0,1fr)]">
        <div className="max-h-[560px] overflow-y-auto border-b border-[#e3ebf5] bg-[#fbfdff] p-2 lg:border-b-0 lg:border-r">
          {pendingIds.length ? (
            <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-[#52627b]">
              <input
                type="checkbox"
                checked={allPendingSelected}
                onChange={() => setSelectedIds(allPendingSelected ? new Set() : new Set(pendingIds))}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              全选待确认草案
            </label>
          ) : null}
          <div className="space-y-1.5">
            {actions.map((action) => {
              const active = action.id === activeAction.id;
              const selectable = action.status === "PENDING_APPROVAL";
              return (
                <div
                  key={action.id}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border p-2 transition-colors",
                    active ? "border-blue-300 bg-blue-50" : "border-transparent bg-white hover:border-[#dce6f3]",
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择草案 ${action.offerId ?? action.title}`}
                    checked={selectable && selectedIds.has(action.id)}
                    disabled={!selectable || Boolean(batchProgress)}
                    onChange={() => toggleSelected(action.id)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setActiveId(action.id)}
                    className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 text-sm font-semibold text-[#26334d]">{draftProductLabel(action)}</span>
                      {active ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={statusTone(action.status)}>{contentDraftStatusLabel(action.status)}</Badge>
                      {executableFieldLabels(action).map((label) => <Badge key={label}>{label}</Badge>)}
                    </div>
                    {action.offerId ? <div className="mt-1 truncate text-[11px] text-[#8290a8]">{action.offerId}</div> : null}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-bold text-[#17223d]">{draftProductLabel(activeAction)}</div>
              <div className="mt-1 text-xs text-[#667085]">{activeAction.offerId ?? "未提供 offerId"}</div>
            </div>
            <div className="flex gap-1.5">
              <Badge tone={statusTone(activeAction.status)}>{contentDraftStatusLabel(activeAction.status)}</Badge>
              <Badge tone={riskTone(activeAction.riskLevel)}>{riskLabel(activeAction.riskLevel)}</Badge>
            </div>
          </div>

          <details className="mt-3 rounded-lg border border-[#e3ebf5] bg-[#f8fbff] px-3 py-2 text-xs text-[#52627b]">
            <summary className="cursor-pointer font-semibold text-[#35415a]">查看修改依据</summary>
            <p className="mt-2 leading-5">{activeAction.rationale}</p>
          </details>

          <div className="mt-4 space-y-4">
            {activeGroups.executable.map((rawItem) => {
              const item = rawItem as DraftSuggestion;
              const originalIndex = activeSuggestions.findIndex((suggestion) => suggestion.field === item.field);
              const inputId = `draft-${activeAction.id}-${item.field}`;
              return (
                <div key={item.field}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label htmlFor={inputId} className="text-sm font-bold text-[#26334d]">{fieldLabel(item.field)}</label>
                    {item.sourceTag ? <Badge tone="blue">{String(item.sourceTag)}</Badge> : null}
                  </div>
                  <div className="grid gap-2 xl:grid-cols-2">
                    <div className="rounded-lg border border-[#e3e9f1] bg-gray-50 p-3">
                      <div className="mb-1 text-[11px] font-semibold text-gray-500">修改前</div>
                      <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-[#52627b]">
                        {String(item.current ?? "").trim() || "当前未填写"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#bfe7e2] bg-[#effcf9] p-3">
                      <div className="mb-1 text-[11px] font-semibold text-[#08776f]">修改后</div>
                      {canEdit ? (
                        <textarea
                          id={inputId}
                          value={item.suggestedRu}
                          onChange={(event) => setSuggestion(activeAction.id, originalIndex, event.target.value)}
                          aria-invalid={!item.suggestedRu.trim()}
                          className="min-h-28 w-full resize-y border-0 bg-transparent p-0 text-sm leading-6 text-gray-950 outline-none"
                        />
                      ) : (
                        <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-gray-950">{item.suggestedRu}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {activeGroups.reference.length ? (
            <details className="mt-4 rounded-lg border border-[#e3ebf5] bg-white px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-[#52627b]">参考内容（不会写入 Ozon）</summary>
              <div className="mt-2 space-y-2">
                {activeGroups.reference.map((item, index) => (
                  <div key={`${String(item.field)}-${index}`} className="text-xs leading-5 text-[#667085]">
                    <span className="font-semibold text-[#35415a]">{fieldLabel(item.field)}：</span>
                    {String(item.suggestedRu ?? "")}
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {validationError ? <div role="alert" className="mt-3 text-sm font-medium text-red-600">{validationError}</div> : null}
          {activeAction.error ? <div role="alert" className="mt-3 text-sm font-medium text-red-600">{activeAction.error}</div> : null}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-[#e3ebf5] pt-3">
            {activeAction.status === "PENDING_APPROVAL" ? (
              <>
                <Button
                  variant="success"
                  disabled={isActiveBusy || Boolean(validationError) || Boolean(batchProgress)}
                  onClick={() => void runAction(activeAction)}
                >
                  {isActiveBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                  {isActiveBusy ? "正在执行" : "确认并执行"}
                </Button>
                <Button
                  variant="outline"
                  disabled={isActiveBusy || Boolean(batchProgress)}
                  onClick={() => void rejectAction(activeAction)}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  拒绝
                </Button>
              </>
            ) : activeAction.status === "APPROVED" ? (
              <Button variant="success" disabled={isActiveBusy} onClick={() => void runAction(activeAction)}>
                {isActiveBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                {isActiveBusy ? "正在执行" : "继续执行"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
