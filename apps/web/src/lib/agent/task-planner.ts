export type ListingTaskStepStatus = "ready" | "done" | "blocked" | "approval_required";

export type ListingTaskPlanInput = {
  hasExternalProducts?: boolean;
  hasOzonStore?: boolean;
  hasCompetitorEvidence?: boolean;
  hasContentDraft?: boolean;
  hasPricingRule?: boolean;
  hasCostData?: boolean;
  hasCompiledDraft?: boolean;
  approvedForPublish?: boolean;
  allowRealOzonSubmit?: boolean;
};

export type ListingTaskStep = {
  id: string;
  title: string;
  status: ListingTaskStepStatus;
  reason?: string;
};

export type ListingTaskPlan = {
  steps: ListingTaskStep[];
  nextStep: ListingTaskStep | null;
  blockedReasons: string[];
};

function makeStep(id: string, title: string, status: ListingTaskStepStatus, reason?: string): ListingTaskStep {
  return { id, title, status, reason };
}

export function buildListingTaskPlan(input: ListingTaskPlanInput): ListingTaskPlan {
  const steps: ListingTaskStep[] = [];
  const blockedReasons: string[] = [];

  if (!input.hasExternalProducts) {
    blockedReasons.push("缺少第三方采集/导入后的商品数据");
    steps.push(makeStep("external_import", "导入/采集商品", "ready"));
    steps.push(makeStep("opportunity_scoring", "选品评分", "blocked", "需要先有商品数据"));
    steps.push(makeStep("competitor_evidence", "采集竞品证据", "blocked", "需要先完成选品"));
    steps.push(makeStep("content_generation", "生成俄语内容", "blocked", "需要竞品证据和商品事实"));
    steps.push(makeStep("pricing_guardrail", "计算价格和利润", "blocked", "需要成本和价格规则"));
    steps.push(makeStep("draft_compile", "编译 Ozon 草稿", "blocked", "需要内容和价格"));
    steps.push(makeStep("human_approval", "人工审批", "blocked", "需要先生成草稿"));
    steps.push(makeStep("publish_submission", "提交 Ozon", "blocked", "需要审批"));
    return { steps, nextStep: steps[0] ?? null, blockedReasons };
  }

  steps.push(makeStep("external_import", "导入/采集商品", "done"));
  steps.push(makeStep("opportunity_scoring", "选品评分", "done"));

  if (!input.hasCompetitorEvidence) {
    steps.push(makeStep("competitor_evidence", "采集竞品证据", "ready"));
    steps.push(makeStep("content_generation", "生成俄语内容", "blocked", "需要竞品属性经验"));
    steps.push(makeStep("pricing_guardrail", "计算价格和利润", "blocked", "需要先生成内容"));
    steps.push(makeStep("draft_compile", "编译 Ozon 草稿", "blocked", "需要内容和价格"));
    steps.push(makeStep("human_approval", "人工审批", "blocked", "需要先生成草稿"));
    steps.push(makeStep("publish_submission", "提交 Ozon", "blocked", "需要审批"));
    return { steps, nextStep: steps.find((step) => step.status === "ready") ?? null, blockedReasons };
  }

  steps.push(makeStep("competitor_evidence", "采集竞品证据", "done"));

  if (!input.hasContentDraft) {
    steps.push(makeStep("content_generation", "生成俄语内容", "ready"));
    steps.push(makeStep("pricing_guardrail", "计算价格和利润", "blocked", "需要成本和价格规则"));
    steps.push(makeStep("draft_compile", "编译 Ozon 草稿", "blocked", "需要内容和价格"));
    steps.push(makeStep("human_approval", "人工审批", "blocked", "需要先生成草稿"));
    steps.push(makeStep("publish_submission", "提交 Ozon", "blocked", "需要审批"));
    return { steps, nextStep: steps.find((step) => step.status === "ready") ?? null, blockedReasons };
  }

  steps.push(makeStep("content_generation", "生成俄语内容", "done"));

  if (!input.hasPricingRule || !input.hasCostData) {
    if (!input.hasPricingRule) blockedReasons.push("缺少定价规则");
    if (!input.hasCostData) blockedReasons.push("缺少商品成本数据");
    steps.push(makeStep("pricing_guardrail", "计算价格和利润", "ready"));
    steps.push(makeStep("draft_compile", "编译 Ozon 草稿", "blocked", "需要价格校验"));
    steps.push(makeStep("human_approval", "人工审批", "blocked", "需要先生成草稿"));
    steps.push(makeStep("publish_submission", "提交 Ozon", "blocked", "需要审批"));
    return { steps, nextStep: steps.find((step) => step.status === "ready") ?? null, blockedReasons };
  }

  steps.push(makeStep("pricing_guardrail", "计算价格和利润", "done"));

  if (!input.hasOzonStore || !input.hasCompiledDraft) {
    if (!input.hasOzonStore) blockedReasons.push("缺少 Ozon 店铺配置");
    steps.push(makeStep("draft_compile", "编译 Ozon 草稿", "ready"));
    steps.push(makeStep("human_approval", "人工审批", "blocked", "需要先生成草稿"));
    steps.push(makeStep("publish_submission", "提交 Ozon", "blocked", "需要审批"));
    return { steps, nextStep: steps.find((step) => step.status === "ready") ?? null, blockedReasons };
  }

  steps.push(makeStep("draft_compile", "编译 Ozon 草稿", "done"));

  if (!input.approvedForPublish) {
    blockedReasons.push("发布前需要人工审批");
    steps.push(makeStep("human_approval", "人工审批", "approval_required"));
    steps.push(makeStep("publish_submission", "提交 Ozon", "blocked", "需要审批"));
    return { steps, nextStep: steps.find((step) => step.status === "approval_required") ?? null, blockedReasons };
  }

  steps.push(makeStep("human_approval", "人工审批", "done"));

  if (!input.allowRealOzonSubmit) {
    blockedReasons.push("真实 Ozon 提交开关未开启");
    steps.push(makeStep("publish_submission", "提交 Ozon", "blocked", "需要开启真实提交门禁"));
    return { steps, nextStep: null, blockedReasons };
  }

  steps.push(makeStep("publish_submission", "提交 Ozon", "ready"));
  return { steps, nextStep: steps.find((step) => step.id === "publish_submission") ?? null, blockedReasons };
}
