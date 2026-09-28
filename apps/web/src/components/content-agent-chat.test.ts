import { describe, expect, it, vi } from "vitest";
import {
  attributeChangesFromPayload,
  actionNeedsPolling,
  initialContentAgentSessionId,
  mapPersistedChatMessage,
  pollAgentAction,
  pollAgentRunTrace,
  recoverableAgentRun,
  resumableActionIds,
  sessionsAfterArchive,
  shouldApplyArchivedSessionResponse,
  shouldShowCommandDeck,
  isConversationNearBottom,
  startContentAgentRun,
} from "./content-agent-chat";
import {
  contentDraftStatusLabel,
  contentDraftStatusNotice,
  displayedDraftSuggestions,
  draftSuggestionGroups,
  initialSelectedDraftIds,
  validateDraftSuggestions,
} from "./content-agent-drafts";

describe("content agent action preview", () => {
  it("does not follow new updates while the merchant is reading comparison evidence", () => {
    expect(isConversationNearBottom({ scrollHeight: 2000, scrollTop: 400, clientHeight: 700 })).toBe(false);
    expect(isConversationNearBottom({ scrollHeight: 2000, scrollTop: 1260, clientHeight: 700 })).toBe(true);
  });
  it.each(["content_agent_queue_unavailable", "content_agent_run_in_progress"])("reconnects to persisted tasks after %s", async (code) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false, status: code === "content_agent_run_in_progress" ? 409 : 503,
      json: async () => ({ error: { code, message: "already saved", details: [{ sessionId: "session-1", runId: "run-1" }] } }),
    } as Response);
    try {
      expect(await startContentAgentRun("new", { prompt: "test", storeId: "store" })).toMatchObject({ sessionId: "session-1", runId: "run-1", status: "running" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { fetchMock.mockRestore(); }
  });

  it("cancels diagnosis polling during a retry delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    try {
      const result = pollAgentRunTrace("run-1", () => undefined, controller.signal).catch((error) => error);
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(await Promise.race([result, Promise.resolve("still waiting")])).toMatchObject({ name: "AbortError" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { fetchMock.mockRestore(); vi.useRealTimers(); }
  });
  it("keeps a long diagnosis connected across transient network failures", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return { ok: true, json: async () => ({ data: {
        status: calls > 245 ? "succeeded" : "running", executionTrace: [],
      } }) } as Response;
    });
    try {
      const result = pollAgentRunTrace("run-1", () => undefined).catch((error) => ({ error }));
      await vi.advanceTimersByTimeAsync(1_000_000);
      expect((await result).status).toBe("succeeded");
    } finally { fetchMock.mockRestore(); vi.useRealTimers(); }
  });

  it("stops diagnosis polling when access is revoked", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false, status: 403, json: async () => ({ error: { message: "forbidden" } }),
    } as Response);
    try {
      await expect(pollAgentRunTrace("run-1", () => undefined)).rejects.toThrow("forbidden");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { fetchMock.mockRestore(); }
  });
  it("keeps polling queued actions until execution reaches a stable state", () => {
    expect(actionNeedsPolling({ status: "APPROVED" })).toBe(true);
    expect(actionNeedsPolling({ status: "BLOCKED", executionPhase: "executing" })).toBe(true);
    expect(actionNeedsPolling({ status: "BLOCKED", executionPhase: "verification_pending" })).toBe(true);
    expect(actionNeedsPolling({ status: "BLOCKED", executionPhase: "manual_required" })).toBe(false);
    expect(actionNeedsPolling({ status: "EXECUTED" })).toBe(false);
  });

  it("resumes only unfinished actions when reopening a conversation", () => {
    expect(resumableActionIds([
      { actions: [
        { id: "approved", status: "APPROVED" },
        { id: "writing", status: "BLOCKED", executionPhase: "executing" },
        { id: "done", status: "EXECUTED" },
      ] },
      { actions: [{ id: "writing", status: "BLOCKED", executionPhase: "executing" }] },
    ])).toEqual(["approved", "writing"]);
  });

  it("reconnects after a temporary request failure and updates the completed action", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("temporary network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { action: { id: "a1", status: "BLOCKED", executionPhase: "executing" } } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { action: { id: "a1", status: "EXECUTED" } } }),
      } as Response);
    const updates: string[] = [];
    try {
      const polling = pollAgentAction("a1", (action) => updates.push(action.status));
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await polling)?.status).toBe("EXECUTED");
      expect(updates).toEqual(["BLOCKED", "EXECUTED"]);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("returns every attribute change needed for approval", () => {
    expect(attributeChangesFromPayload({
      recommendations: [
        {
          offerId: "SKU-1",
          ozonNameRu: "Материал",
          competitorNameRu: "Материал",
          suggestedValue: "Хлопок",
          required: true,
          reasonZh: "自家商品描述包含该值。",
          evidenceUrls: ["https://www.ozon.ru/product/1/"],
        },
        {
          offerId: "SKU-2",
          ozonNameRu: "Сезон",
          suggestedValue: "Лето",
          required: false,
          reasonZh: "自家商品描述包含该值。",
          evidenceUrls: [],
        },
      ],
    })).toEqual([
      {
        offerId: "SKU-1",
        attributeName: "Материал",
        suggestedValue: "Хлопок",
        required: true,
        reasonZh: "自家商品描述包含该值。",
        evidenceUrl: "https://www.ozon.ru/product/1/",
      },
      {
        offerId: "SKU-2",
        attributeName: "Сезон",
        suggestedValue: "Лето",
        required: false,
        reasonZh: "自家商品描述包含该值。",
        evidenceUrl: null,
      },
    ]);
  });

  it("drops malformed changes instead of showing an unsafe approval preview", () => {
    expect(attributeChangesFromPayload({ recommendations: [{ offerId: "SKU-1" }] })).toEqual([]);
  });
});

describe("content agent draft review", () => {
  const actions = [
    { id: "pending-1", type: "CONTENT_DRAFT", status: "PENDING_APPROVAL" },
    { id: "executed", type: "CONTENT_DRAFT", status: "EXECUTED" },
    { id: "pending-2", type: "CONTENT_DRAFT", status: "PENDING_APPROVAL" },
  ];

  it("selects every pending draft by default for batch execution", () => {
    expect(initialSelectedDraftIds(actions)).toEqual(["pending-1", "pending-2"]);
  });

  it("uses user-facing Chinese action statuses", () => {
    expect(contentDraftStatusLabel("PENDING_APPROVAL")).toBe("待确认");
    expect(contentDraftStatusLabel("BLOCKED", "execution_in_progress")).toBe("正在执行");
    expect(contentDraftStatusLabel("BLOCKED", "result_pending_verification")).toBe("核对结果中");
    expect(contentDraftStatusLabel("EXECUTED")).toBe("已执行");
    expect(contentDraftStatusLabel("FAILED")).toBe("执行失败");
  });

  it("separates executable fields from reference-only keywords", () => {
    expect(draftSuggestionGroups([
      { field: "title", current: "旧标题", suggestedRu: "新标题" },
      { field: "keywords", current: "", suggestedRu: "платье, лето" },
      { field: "description", current: "旧描述", suggestedRu: "新描述" },
    ])).toEqual({
      executable: [
        { field: "title", current: "旧标题", suggestedRu: "新标题" },
        { field: "description", current: "旧描述", suggestedRu: "新描述" },
      ],
      reference: [
        { field: "keywords", current: "", suggestedRu: "платье, лето" },
      ],
    });
  });

  it("blocks execution when an executable suggestion is blank", () => {
    expect(validateDraftSuggestions([
      { field: "title", suggestedRu: "   " },
      { field: "description", suggestedRu: "有效描述" },
    ])).toBe("标题不能为空");
    expect(validateDraftSuggestions([
      { field: "title", suggestedRu: "有效标题" },
      { field: "description", suggestedRu: "有效描述" },
    ])).toBeNull();
  });

  it("treats an in-progress write as progress rather than an error", () => {
    expect(contentDraftStatusNotice({ status: "BLOCKED", error: "execution_in_progress" })).toEqual({
      tone: "progress",
      message: "正在写入 Ozon，完成后自动显示结果。",
    });
    expect(contentDraftStatusNotice({ status: "BLOCKED", error: "result_pending_verification" })).toEqual({
      tone: "progress",
      message: "Ozon 已接收，正在核对修改结果。",
    });
    expect(contentDraftStatusNotice({ status: "EXECUTED", error: null })).toBeNull();
    expect(contentDraftStatusNotice({ status: "FAILED", error: "write_failed" })).toEqual({
      tone: "error",
      message: "执行失败，请查看任务详情。",
    });
  });

  it("rejects an overlong or duplicated executable field as a whole", () => {
    expect(validateDraftSuggestions([
      { field: "title", suggestedRu: "有效标题" },
      { field: "description", suggestedRu: "x".repeat(3001) },
    ])).toBe("描述不能超过 3000 个字符");
    expect(validateDraftSuggestions([
      { field: "title", suggestedRu: "标题一" },
      { field: "title", suggestedRu: "标题二" },
    ])).toBe("标题重复提交");
  });

  it("never presents an unsubmitted local edit as executed content", () => {
    expect(displayedDraftSuggestions({
      status: "EXECUTED",
      updatedAt: "v2",
      payload: { suggestions: [{ field: "title", suggestedRu: "实际执行标题" }] },
    }, [{ field: "title", suggestedRu: "另一标签页未提交标题" }], "v1")).toEqual({
      suggestions: [{ field: "title", suggestedRu: "实际执行标题" }],
      discardedLocalEdit: true,
    });
  });

  it("keeps local edits while the draft still awaits approval", () => {
    expect(displayedDraftSuggestions({
      status: "PENDING_APPROVAL",
      updatedAt: "v1",
      payload: { suggestions: [{ field: "title", suggestedRu: "服务端标题" }] },
    }, [{ field: "title", suggestedRu: "本页编辑标题" }], "v1")).toEqual({
      suggestions: [{ field: "title", suggestedRu: "本页编辑标题" }],
      discardedLocalEdit: false,
    });
  });

  it("stops presenting edits based on an older pending draft version", () => {
    expect(displayedDraftSuggestions({
      status: "PENDING_APPROVAL",
      updatedAt: "v2",
      payload: { suggestions: [{ field: "title", suggestedRu: "服务端新版本" }] },
    }, [{ field: "title", suggestedRu: "本页旧编辑" }], "v1")).toEqual({
      suggestions: [{ field: "title", suggestedRu: "服务端新版本" }],
      discardedLocalEdit: true,
    });
  });
});

describe("content agent command deck", () => {
  it("only shows before the user starts a conversation", () => {
    expect(shouldShowCommandDeck([{ role: "assistant" }])).toBe(true);
    expect(shouldShowCommandDeck([{ role: "assistant" }, { role: "user" }])).toBe(false);
  });

  it("opens the latest existing session instead of starting a new chat", () => {
    expect(initialContentAgentSessionId([
      { id: "recent", title: "最近", status: "OPEN", updatedAt: "2026-09-20T10:00:00.000Z" },
      { id: "old", title: "旧", status: "OPEN", updatedAt: "2026-09-19T10:00:00.000Z" },
    ])).toBe("recent");
    expect(initialContentAgentSessionId([])).toBe("new");
  });

  it("keeps the saved execution plan and trace when loading history", () => {
    const message = mapPersistedChatMessage({
      id: "message-1",
      role: "assistant",
      content: "诊断完成",
      createdAt: "2026-09-24T10:00:00.000Z",
      requestPrompt: "只做商品内容诊断",
      plan: [{ id: "plan", kind: "PLAN_TASK", title: "计划", description: "计划任务", status: "succeeded" }],
      executionTrace: [
        { id: "trace", kind: "DIAGNOSE_STORE", title: "诊断", description: "读取店铺", status: "succeeded" },
        { id: "summary", kind: "SUMMARIZE_CATEGORY_PLAYBOOK", title: "总结", description: "总结差距", status: "pending" },
      ],
    });

    expect(message.plan?.[0]?.id).toBe("plan");
    expect(message.executionTrace?.[0]?.id).toBe("trace");
    expect(message.executionTrace?.[1]?.status).toBe("succeeded");
    expect(message.requestPrompt).toBe("只做商品内容诊断");
  });

  it("removes an archived session and opens the next available conversation", () => {
    expect(sessionsAfterArchive([
      { id: "current", title: "当前", status: "OPEN", updatedAt: "2026-09-24T10:00:00.000Z" },
      { id: "next", title: "下一个", status: "OPEN", updatedAt: "2026-09-23T10:00:00.000Z" },
    ], "current", "current")).toEqual({
      sessions: [{ id: "next", title: "下一个", status: "OPEN", updatedAt: "2026-09-23T10:00:00.000Z" }],
      selectedSessionId: "next",
    });
  });

  it("does not let a late archive response switch a newer selection", () => {
    expect(shouldApplyArchivedSessionResponse("archived", "other")).toBe(false);
    expect(shouldApplyArchivedSessionResponse("archived", "archived")).toBe(true);
  });

  it("recognizes a persisted running task after history reload", () => {
    expect(recoverableAgentRun({
      activeRun: {
        runId: "run-1",
        status: "running",
        plan: [],
        executionTrace: [{ id: "step", status: "running" }],
      },
    })).toMatchObject({
      runId: "run-1",
      status: "running",
      plan: [],
      executionTrace: [{ id: "step", status: "running" }],
    });
    expect(recoverableAgentRun({ activeRun: { status: "running" } })).toBeNull();
  });
});
