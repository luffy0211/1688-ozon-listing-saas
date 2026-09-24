import { describe, expect, it } from "vitest";
import {
  attributeChangesFromPayload,
  initialContentAgentSessionId,
  mapPersistedChatMessage,
  sessionsAfterArchive,
  shouldShowCommandDeck,
} from "./content-agent-chat";
import {
  contentDraftStatusLabel,
  draftSuggestionGroups,
  initialSelectedDraftIds,
  validateDraftSuggestions,
} from "./content-agent-drafts";

describe("content agent action preview", () => {
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
});
