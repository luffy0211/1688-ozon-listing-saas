import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { competitorsPerCategoryFromPrompt, requiredOzonToolForPrompt } from "@/lib/agent/content-agent";
import {
  CompetitorComparison,
  comparisonSamples,
  matchingContentDraft,
  refreshComparisonPrompt,
} from "./competitor-comparison";

const sample = {
  storeId: "shop-a", offerId: "own-1", categoryName: "Поло", typeId: 7,
  capturedAt: "2020-01-01T00:00:00Z",
  own: { title: "Поло мужское", description: "old summary", fullDescription: "完整简介 ".repeat(70), priceRub: 1200, imageUrl: "https://ir.ozone.ru/own.jpg" },
  competitors: Array.from({ length: 8 }, (_, index) => ({
    sku: String(index), title: `参考商品 ${index + 1}`, priceRub: 1350,
    description: "历史摘要", url: `https://www.ozon.ru/product/${index}/`,
    imageUrl: `https://ir.ozone.ru/${index}.jpg`, reviewCount: 120,
    extractedKeywords: [{ term: "хлопок", count: 1 }],
  })),
};
const action = { id: "draft-a", type: "CONTENT_DRAFT", status: "PENDING_APPROVAL", storeId: "shop-a", offerId: "own-1", payload: { suggestions: [{ field: "title", current: "Поло мужское", suggestedRu: "Поло на каждый день" }] } };
const source = { toolName: "analyze_ozon_competitors", label: "参考", status: "ok" as const, at: "2020-01-01", contentDiagnosis: { samples: [sample] } };

describe("merchant competitor comparison", () => {
  it("keeps all available categories and competitors", () => {
    const samples = Array.from({ length: 7 }, (_, index) => ({ ...sample, offerId: `own-${index}`, categoryName: `类目${index}` }));
    expect(comparisonSamples({ samples })).toHaveLength(7);
    const html = renderToStaticMarkup(createElement(CompetitorComparison, { source: { ...source, contentDiagnosis: { samples } } }));
    expect(html).toContain("类目6");
    expect(html).toContain("参考商品 8");
  });

  it("shows actual content and labels missing sales, summaries and extracted keywords", () => {
    const html = renderToStaticMarkup(createElement(CompetitorComparison, { source }));
    expect(html).toContain("完整简介 ".repeat(70).trim());
    expect(html).toContain("历史摘要");
    expect(html).toContain("仅有摘要");
    expect(html).toContain("暂无销量数据");
    expect(html).toContain("文案关键词");
    expect(html).toContain("暂无标签数据");
    expect(html).toContain("/api/v1/image-proxy?url=");
    expect(html).not.toContain("8张");
    expect(html).not.toContain("100–500");
  });

  it("only links a pending draft for the exact store and offer", () => {
    expect(matchingContentDraft(sample, [action])?.id).toBe("draft-a");
    expect(matchingContentDraft({ ...sample, storeId: "shop-b" }, [action])).toBeUndefined();
    expect(matchingContentDraft({ ...sample, storeId: null }, [action])).toBeUndefined();
    expect(matchingContentDraft(sample, [{ ...action, offerId: "other" }])).toBeUndefined();
    expect(matchingContentDraft(sample, [{ ...action, status: "EXECUTED" }])).toBeUndefined();
    const html = renderToStaticMarkup(createElement(CompetitorComparison, { source, actions: [action], onOpenDraft: () => undefined }));
    expect(html).toContain("查看并编辑修改内容");
    expect(html).not.toContain("确认执行");
  });

  it("keeps refresh scoped to this category and its actual sample count", () => {
    expect(refreshComparisonPrompt(sample)).toContain("Поло");
    expect(refreshComparisonPrompt(sample)).toContain("8 个");
    expect(competitorsPerCategoryFromPrompt(refreshComparisonPrompt(sample))).toBe(8);
    expect(requiredOzonToolForPrompt(refreshComparisonPrompt(sample), sample.offerId)).toBe("analyze_ozon_competitors");
    expect(refreshComparisonPrompt(sample)).not.toContain("每个类目 1 个");
    const html = renderToStaticMarkup(createElement(CompetitorComparison, { source, activeStoreId: "other", onRun: () => undefined }));
    expect(html).toContain("更新竞品");
    expect(html).toContain("先切换到该报告的店铺");
  });

  it("does not turn missing values into zero or execute suggestions without a draft", () => {
    const empty = { ...sample, own: { title: "自家" }, competitors: [{ title: "竞品", url: "javascript:alert(1)", imageUrl: "data:text/html,unsafe" }] };
    const html = renderToStaticMarkup(createElement(CompetitorComparison, { source: { ...source, contentDiagnosis: { samples: [empty] } } }));
    expect(html).toContain("价格暂未获取");
    expect(html).toContain("暂未获取简介");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).not.toContain("查看并编辑修改内容");
  });

  it("shows image advice only when it belongs to the displayed image", () => {
    const input = { ...sample, own: { ...sample.own, imageAnalysis: { imageUrl: sample.own.imageUrl, recommendationZh: "主体完整，保留这张主图" } },
      competitors: [{ ...sample.competitors[0], imageAnalysis: { imageUrl: "https://ir.ozone.ru/other.jpg", recommendationZh: "不应出现的别图建议" } }] };
    const html = renderToStaticMarkup(createElement(CompetitorComparison, { source: { ...source, contentDiagnosis: { samples: [input] } } }));
    expect(html).toContain("主体完整，保留这张主图");
    expect(html).not.toContain("不应出现的别图建议");
  });
});
