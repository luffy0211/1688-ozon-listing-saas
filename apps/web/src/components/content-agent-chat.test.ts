import { describe, expect, it } from "vitest";
import { attributeChangesFromPayload, initialContentAgentSessionId, shouldShowCommandDeck } from "./content-agent-chat";

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
});
