import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AgentInsightPanel,
  insightPresentationFor,
  safeExternalUrl,
  type AgentInsightSource,
} from "./agent-insight-panel";

const diagnosisSource: AgentInsightSource = {
  toolName: "diagnose_ozon_store",
  label: "Ozon 店铺经营诊断",
  status: "ok",
  at: "2026-09-24T00:00:00.000Z",
  productCount: 20,
  visibleProductCount: 18,
  totalStock: 100,
  lowStockCount: 2,
  lowContentRatingCount: 1,
  lowContentRatingProducts: [{
    offerId: "SKU-LOW",
    title: "低分商品",
    imageUrl: null,
    contentRating: 30,
    visible: false,
    stock: 2,
    priceRub: 999,
    recommendations: ["简介缺失"],
  }],
};

const competitorSource: AgentInsightSource = {
  toolName: "analyze_ozon_competitors",
  label: "Ozon 同类竞品证据",
  status: "ok",
  at: "2026-09-24T00:00:00.000Z",
  contentDiagnosis: {
    samples: [{
      offerId: "OWN-1",
      own: {
        title: "自家商品",
        imageUrl: "https://ir.ozone.ru/s3/multimedia-own.jpg",
      },
      competitors: [{
        title: "竞品商品",
        url: "https://www.ozon.ru/product/1/",
        imageUrl: "https://ir.ozone.ru/s3/multimedia-competitor.jpg",
      }],
      comparison: {},
    }],
  },
};

function renderPanel(requestPrompt: string, actions: Array<{ type: string }> = []) {
  return renderToStaticMarkup(createElement(AgentInsightPanel, {
    sources: [diagnosisSource],
    requestPrompt,
    actions,
    onRun: () => undefined,
  }));
}

describe("agent insight presentation", () => {
  it("shows the full store report only for broad store diagnosis", () => {
    expect(insightPresentationFor("帮我做一次店铺诊断", [])).toEqual({
      showStoreDiagnosis: true,
      showContentDiagnosis: false,
      showContentProducts: false,
      showCompetitorComparison: false,
    });
  });

  it("keeps the full report for the built-in deep diagnosis prompt", () => {
    expect(insightPresentationFor(
      "请对当前店铺做完整诊断，找出内容评分最低的商品，给出建议，并为最紧急的商品生成待确认优化方案。",
      [],
    )).toEqual({
      showStoreDiagnosis: true,
      showContentDiagnosis: true,
      showContentProducts: true,
      showCompetitorComparison: true,
    });
  });

  it("keeps an explicitly scoped content diagnosis focused on content", () => {
    expect(insightPresentationFor("给店铺做诊断，但只看商品内容", [])).toEqual({
      showStoreDiagnosis: false,
      showContentDiagnosis: true,
      showContentProducts: true,
      showCompetitorComparison: true,
    });
  });

  it("does not repeat product cards after content drafts exist", () => {
    expect(insightPresentationFor("诊断内容并生成优化草案", [
      { type: "CONTENT_DRAFT" },
    ])).toEqual({
      showStoreDiagnosis: false,
      showContentDiagnosis: true,
      showContentProducts: false,
      showCompetitorComparison: true,
    });
  });

  it("shows competitor evidence only when the user asks for competitors", () => {
    expect(insightPresentationFor("分析同类竞品的标题和简介", [])).toEqual({
      showStoreDiagnosis: false,
      showContentDiagnosis: false,
      showContentProducts: false,
      showCompetitorComparison: true,
    });
  });

  it("shows both requested sections when content diagnosis includes competitor comparison", () => {
    expect(insightPresentationFor("请做内容诊断，并对比同类竞品", [])).toEqual({
      showStoreDiagnosis: false,
      showContentDiagnosis: true,
      showContentProducts: true,
      showCompetitorComparison: true,
    });
  });

  it("does not expand a full store report for a narrowed inventory diagnosis", () => {
    expect(insightPresentationFor("店铺诊断，但只看库存", [])).toEqual({
      showStoreDiagnosis: false,
      showContentDiagnosis: false,
      showContentProducts: false,
      showCompetitorComparison: false,
    });
  });

  it("does not turn unrelated tasks into a diagnosis report", () => {
    expect(insightPresentationFor("把这三个商品的库存补到 20", [])).toEqual({
      showStoreDiagnosis: false,
      showContentDiagnosis: false,
      showContentProducts: false,
      showCompetitorComparison: false,
    });
  });

  it("renders only content evidence and guidance for a content diagnosis", () => {
    const html = renderPanel("只做商品内容诊断");

    expect(html).toContain("商品内容诊断");
    expect(html).toContain("需要优化的商品");
    expect(html).toContain("生成内容草案");
    expect(html).not.toContain("店铺运营诊断报告");
    expect(html).not.toContain("库存 2");
    expect(html).not.toContain("价格 999");
  });

  it("collapses duplicate product cards when drafts already exist", () => {
    const html = renderPanel("诊断内容并生成优化草案", [{ type: "CONTENT_DRAFT" }]);

    expect(html).toContain("本轮已生成 1 份内容草案");
    expect(html).not.toContain("需要优化的商品");
    expect(html).not.toContain("SKU-LOW");
  });

  it("renders guided issue actions for a broad store diagnosis", () => {
    const html = renderPanel("帮我做一次店铺诊断");

    expect(html).toContain("店铺运营诊断报告");
    expect(html).toContain("选择一项继续处理");
    expect(html).toContain("查看并处理");
    expect(html).not.toContain("需要优化的商品");
  });

  it("allows only HTTP links from external competitor evidence", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,unsafe")).toBeNull();
    expect(safeExternalUrl("https://www.ozon.ru/product/1/")).toBe("https://www.ozon.ru/product/1/");
    expect(safeExternalUrl("http://example.com/product/1")).toBe("http://example.com/product/1");
  });

  it("renders Ozon competitor images through the authenticated image proxy", () => {
    const html = renderToStaticMarkup(createElement(AgentInsightPanel, {
      sources: [competitorSource],
      requestPrompt: "分析同类竞品",
    }));

    expect(html).toContain(
      "/api/v1/image-proxy?url=https%3A%2F%2Fir.ozone.ru%2Fs3%2Fmultimedia-competitor.jpg",
    );
  });

  it("shows the competitor section for a deep diagnosis even without competitor data", () => {
    expect(insightPresentationFor("给我的店铺做一次深度诊断", []).showCompetitorComparison).toBe(true);
    const html = renderPanel("请对当前店铺做完整诊断，找出内容评分最低的商品，给出建议，并为最紧急的商品生成待确认优化方案。");
    expect(html).toContain("同类竞品对比");
    expect(html).toContain("暂时无法对比");
  });

  it("shows old competitor evidence and lets the user decide whether to refresh", () => {
    const onRun = () => undefined;
    const html = renderToStaticMarkup(createElement(AgentInsightPanel, {
      sources: [{ ...competitorSource, contentDiagnosis: {
        samples: [{
          ...((competitorSource.contentDiagnosis as { samples: Record<string, unknown>[] }).samples[0]),
          capturedAt: "2020-01-01T00:00:00.000Z",
        }],
      } }],
      requestPrompt: "优化商品内容",
      actions: [],
      onRun,
    }));

    expect(html).toContain("竞品数据已超过 7 天");
    expect(html).toContain("更新竞品");
    expect(html).toContain("竞品商品");
  });

  it("shows unread own content as unavailable instead of claiming it is empty", () => {
    const source = structuredClone(competitorSource);
    const sample = (source.contentDiagnosis as { samples: Array<Record<string, unknown>> }).samples[0]!;
    sample.own = { title: "自家商品", imageUrl: null };
    sample.comparison = {
      mainImage: { ownImageCount: 0, ownReadState: "read_failed" },
      description: { ownAvailable: false, ownReadState: "read_failed", competitorAvailableCount: 0 },
    };

    const html = renderToStaticMarkup(createElement(AgentInsightPanel, {
      sources: [source],
      requestPrompt: "分析同类竞品",
    }));

    expect(html).toContain("图片暂未获取");
    expect(html).toContain("暂未获取简介");
    expect(html).not.toContain("自家无图");
    expect(html).not.toContain("简介为空");
  });
});
