import { describe, expect, it } from "vitest";

import { buildListingTaskPlan } from "./task-planner";

describe("buildListingTaskPlan", () => {
  it("starts from third-party import when no product data exists", () => {
    const plan = buildListingTaskPlan({});

    expect(plan.nextStep?.id).toBe("external_import");
    expect(plan.steps.find((step) => step.id === "external_import")?.status).toBe("ready");
    expect(plan.steps.find((step) => step.id === "opportunity_scoring")?.status).toBe("blocked");
    expect(plan.blockedReasons).toContain("缺少第三方采集/导入后的商品数据");
  });

  it("requires human approval before publishing compiled drafts", () => {
    const plan = buildListingTaskPlan({
      approvedForPublish: false,
      hasCompiledDraft: true,
      hasCompetitorEvidence: true,
      hasContentDraft: true,
      hasCostData: true,
      hasExternalProducts: true,
      hasOzonStore: true,
      hasPricingRule: true,
    });

    expect(plan.nextStep?.id).toBe("human_approval");
    expect(plan.steps.find((step) => step.id === "human_approval")?.status).toBe("approval_required");
    expect(plan.steps.find((step) => step.id === "publish_submission")?.status).toBe("blocked");
    expect(plan.blockedReasons).toContain("发布前需要人工审批");
  });

  it("unblocks publish only after approval and real submit gate are enabled", () => {
    const plan = buildListingTaskPlan({
      allowRealOzonSubmit: true,
      approvedForPublish: true,
      hasCompiledDraft: true,
      hasCompetitorEvidence: true,
      hasContentDraft: true,
      hasCostData: true,
      hasExternalProducts: true,
      hasOzonStore: true,
      hasPricingRule: true,
    });

    expect(plan.nextStep?.id).toBe("publish_submission");
    expect(plan.steps.find((step) => step.id === "publish_submission")?.status).toBe("ready");
    expect(plan.blockedReasons).toEqual([]);
  });
});
