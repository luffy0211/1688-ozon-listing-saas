import { describe, expect, it } from "vitest";

import { insightPresentationFor } from "./agent-insight-panel";

describe("agent insight presentation", () => {
  it("shows the full store report only for broad store diagnosis", () => {
    expect(insightPresentationFor("帮我做一次店铺诊断", [])).toEqual({
      showStoreDiagnosis: true,
      showContentDiagnosis: false,
      showContentProducts: false,
      showCompetitorComparison: false,
    });
  });

  it("keeps an explicitly scoped content diagnosis focused on content", () => {
    expect(insightPresentationFor("给店铺做诊断，但只看商品内容", [])).toEqual({
      showStoreDiagnosis: false,
      showContentDiagnosis: true,
      showContentProducts: true,
      showCompetitorComparison: false,
    });
  });

  it("does not repeat product cards after content drafts exist", () => {
    expect(insightPresentationFor("诊断内容并生成优化草案", [
      { type: "CONTENT_DRAFT" },
    ])).toEqual({
      showStoreDiagnosis: false,
      showContentDiagnosis: true,
      showContentProducts: false,
      showCompetitorComparison: false,
    });
  });

  it("shows competitor evidence only when the user asks for competitors", () => {
    expect(insightPresentationFor("分析同类竞品的标题和简介", [])).toEqual({
      showStoreDiagnosis: false,
      showContentDiagnosis: true,
      showContentProducts: true,
      showCompetitorComparison: true,
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
});
