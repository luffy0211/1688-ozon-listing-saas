import { describe, expect, it } from "vitest";

import {
  competitorsPerCategoryFromPrompt,
  requiredOzonToolsForPrompt,
  shouldRunCompetitorAnalysisForDiagnosis,
} from "./content-agent";

describe("content agent task routing", () => {
  it("does not force competitor collection for store or inventory diagnosis", () => {
    expect(requiredOzonToolsForPrompt("检查店铺库存，不用竞品", null)).toEqual([
      "diagnose_ozon_store",
    ]);
    expect(requiredOzonToolsForPrompt("给我的店铺做一次完整诊断", null)).toEqual([
      "diagnose_ozon_store",
    ]);
    expect(shouldRunCompetitorAnalysisForDiagnosis("给我的店铺做一次完整诊断")).toBe(false);
    expect(competitorsPerCategoryFromPrompt("给我的店铺做一次完整诊断")).toBeNull();
  });

  it("still requires competitor evidence for an explicit competitor request", () => {
    expect(requiredOzonToolsForPrompt("每个类目分析 3 个竞品", null)).toEqual([
      "analyze_ozon_competitors",
    ]);
    expect(competitorsPerCategoryFromPrompt("每个类目分析 3 个竞品")).toBe(3);
  });
});
