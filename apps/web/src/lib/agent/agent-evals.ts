export type AgentRoutingEvalCase = {
  id: string;
  prompt: string;
  expectedTool: string | null;
  expectedPlannerRequired?: boolean;
};

export type AgentRoutingEvalResult = {
  id: string;
  passed: boolean;
  expectedTool: string | null;
  actualTool: string | null;
  expectedPlannerRequired: boolean;
  actualPlannerRequired: boolean;
};

export const AGENT_EVAL_CASES: AgentRoutingEvalCase[] = [
  {
    id: "plain-chat-no-tool",
    prompt: "帮我解释一下 Ozon 标题优化的原则。",
    expectedTool: null,
  },
  {
    id: "own-store-count-requires-snapshot",
    prompt: "我店铺现在有多少商品和库存？",
    expectedTool: "get_ozon_store_snapshot",
  },
  {
    id: "competitor-analysis-requires-evidence",
    prompt: "根据我的店铺商品做一次竞品分析，每个二级类目分析 5 个商品数据。",
    expectedTool: "analyze_ozon_competitors",
    expectedPlannerRequired: true,
  },
  {
    id: "promotion-policy-requires-policy-tool",
    prompt: "以后活动报名按 成本*1.4+物流费+平台佣金 计算，低于 25% 毛利不报名。",
    expectedTool: "compile_promotion_policy",
  },
  {
    id: "single-product-content-requires-product-read",
    prompt: "检查 offerId F18260807vo-0A-XL，只生成一条最安全的修改建议。",
    expectedTool: "get_ozon_product_content",
  },
  {
    id: "listing-plan-requires-planner",
    prompt: "帮我规划从 1688 采集到 Ozon 上架的完整任务。",
    expectedTool: null,
    expectedPlannerRequired: true,
  },
];

export function detectExpectedRoutingTool(prompt: string) {
  if (/竞品|竞争对手/i.test(prompt) && /[1-9一二三四五六七八九十]\s*个/i.test(prompt)) {
    return "analyze_ozon_competitors";
  }
  if (/(?:店铺|我店).{0,12}(?:多少商品|库存|商品数)|(?:多少商品|库存).{0,12}(?:店铺|我店)/i.test(prompt)) {
    return "get_ozon_store_snapshot";
  }
  if (/(?:活动|报名).{0,12}(?:计算|公式|毛利|成本|佣金)|(?:计算方法|活动价|报名规则)/i.test(prompt)) {
    return "compile_promotion_policy";
  }
  if (/offerId\s+[A-Za-z0-9_-]+|offer_id\s+[A-Za-z0-9_-]+/i.test(prompt)) {
    return "get_ozon_product_content";
  }
  return null;
}

export function needsTaskPlanner(prompt: string) {
  return /规划|计划|完整任务|完整流程|闭环|采集到.*上架|竞品分析/i.test(prompt);
}

export function evaluateAgentRoutingCase(testCase: AgentRoutingEvalCase): AgentRoutingEvalResult {
  const actualTool = detectExpectedRoutingTool(testCase.prompt);
  const actualPlannerRequired = needsTaskPlanner(testCase.prompt);
  const expectedPlannerRequired = testCase.expectedPlannerRequired ?? false;
  return {
    id: testCase.id,
    passed:
      actualTool === testCase.expectedTool &&
      actualPlannerRequired === expectedPlannerRequired,
    expectedTool: testCase.expectedTool,
    actualTool,
    expectedPlannerRequired,
    actualPlannerRequired,
  };
}
