export type AgentStepStatus = "pending" | "running" | "succeeded" | "failed" | "waiting" | "skipped";

export type AgentPlanStepKind =
  | "RECEIVE_TASK"
  | "PLAN_TASK"
  | "READ_STORE_SNAPSHOT"
  | "READ_PRODUCT_CONTENT"
  | "DIAGNOSE_STORE"
  | "COLLECT_COMPETITORS"
  | "SUMMARIZE_CATEGORY_PLAYBOOK"
  | "DIAGNOSE_PRODUCTS"
  | "LIST_PROMOTIONS"
  | "READ_PROMOTION_CANDIDATES"
  | "COMPILE_PROMOTION_POLICY"
  | "PROPOSE_PROMOTION_ENROLLMENT"
  | "CREATE_ACTIONS"
  | "WAIT_FOR_APPROVAL"
  | "DIRECT_ANSWER";

export type AgentPlanStep = {
  id: string;
  kind: AgentPlanStepKind;
  title: string;
  description: string;
  expectedTool?: string;
};

export type AgentExecutionStep = AgentPlanStep & {
  status: AgentStepStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  toolName?: string | null;
  inputSummary?: string | null;
  outputSummary?: string | null;
  error?: string | null;
};

type ToolCallLike = {
  name: string;
  at: string;
  input?: unknown;
  output?: unknown;
  error?: string;
};

type PlanParams = {
  prompt: string;
  requiredToolName?: string | null;
  offerId?: string | null;
  competitorsPerCategory?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function step(
  id: string,
  kind: AgentPlanStepKind,
  title: string,
  description: string,
  expectedTool?: string,
): AgentPlanStep {
  return { id, kind, title, description, expectedTool };
}

export function buildAgentPlan(params: PlanParams): AgentPlanStep[] {
  const prompt = params.prompt;
  const requiredToolName = params.requiredToolName ?? null;
  const steps: AgentPlanStep[] = [
    step("receive-task", "RECEIVE_TASK", "接收任务", "记录用户目标、店铺范围和安全约束。"),
    step("plan-task", "PLAN_TASK", "生成执行计划", "按固定 SOP 拆解任务，确定需要读取的数据和工具。"),
  ];

  if (requiredToolName === "analyze_ozon_competitors") {
    steps.push(
      step("read-store", "READ_STORE_SNAPSHOT", "读取店铺类目", "读取自家店铺商品、二级类目和代表商品。", "get_ozon_store_snapshot"),
      step(
        "collect-competitors",
        "COLLECT_COMPETITORS",
        "采集同类竞品",
        `每个类目采集 ${params.competitorsPerCategory ?? "指定数量"} 个高评价同类竞品。`,
        "analyze_ozon_competitors",
      ),
      step("summarize-playbook", "SUMMARIZE_CATEGORY_PLAYBOOK", "总结类目经验", "提取竞品标题、描述和属性填写规律。"),
      step("diagnose-products", "DIAGNOSE_PRODUCTS", "诊断自家商品", "对照类目经验检查自家商品缺口。"),
      step("create-actions", "CREATE_ACTIONS", "生成待审批动作", "只生成可确认建议，不直接写回 Ozon。"),
      step("wait-approval", "WAIT_FOR_APPROVAL", "等待人工确认", "用户确认后才执行修改。"),
    );
    return steps;
  }

  if (requiredToolName === "diagnose_ozon_store") {
    steps.push(
      step("diagnose-store", "DIAGNOSE_STORE", "读取并诊断店铺", "读取经营数据、低分商品和可改进项。", "diagnose_ozon_store"),
      step("create-actions", "CREATE_ACTIONS", "生成优化建议", "为低分或高风险商品生成待确认动作。"),
      step("wait-approval", "WAIT_FOR_APPROVAL", "等待人工确认", "确认前不会修改 Ozon。"),
    );
    return steps;
  }

  if (requiredToolName === "get_ozon_product_content" || params.offerId) {
    steps.push(
      step("read-product", "READ_PRODUCT_CONTENT", "读取商品内容", "读取指定 offerId 的标题、描述、属性、图片和状态。", "get_ozon_product_content"),
      step("create-actions", "CREATE_ACTIONS", "生成内容修改建议", "只生成最安全的待确认修改，不直接执行。"),
      step("wait-approval", "WAIT_FOR_APPROVAL", "等待人工确认", "用户确认后才执行 Ozon API。"),
    );
    return steps;
  }

  if (requiredToolName === "compile_promotion_policy") {
    steps.push(
      step("compile-policy", "COMPILE_PROMOTION_POLICY", "整理活动计算规则", "把用户的活动价算法转换成可复用审批规则。", "compile_promotion_policy"),
      step("wait-approval", "WAIT_FOR_APPROVAL", "等待人工确认", "确认后作为后续活动报名规则。"),
    );
    return steps;
  }

  if (requiredToolName === "propose_promotion_enrollment") {
    steps.push(
      step("list-promotions", "LIST_PROMOTIONS", "读取可报名活动", "读取 Ozon 当前活动列表。", "list_ozon_promotions"),
      step("read-candidates", "READ_PROMOTION_CANDIDATES", "读取候选商品", "读取指定活动候选商品和价格约束。", "get_ozon_promotion_candidates"),
      step("propose-enrollment", "PROPOSE_PROMOTION_ENROLLMENT", "生成报名方案", "按已确认价格公式生成报名动作。", "propose_promotion_enrollment"),
      step("wait-approval", "WAIT_FOR_APPROVAL", "等待人工确认", "确认前不会报名活动。"),
    );
    return steps;
  }

  if (requiredToolName === "list_ozon_promotions") {
    steps.push(
      step("list-promotions", "LIST_PROMOTIONS", "读取活动中心", "读取 Ozon 活动和报名机会。", "list_ozon_promotions"),
      step("direct-answer", "DIRECT_ANSWER", "输出活动建议", "仅解释机会，不直接报名。"),
    );
    return steps;
  }

  if (requiredToolName === "get_ozon_store_snapshot" || /店铺|库存|商品|在售|可见/i.test(prompt)) {
    steps.push(
      step("read-store", "READ_STORE_SNAPSHOT", "读取店铺快照", "读取商品数量、可见状态、库存和草稿。", "get_ozon_store_snapshot"),
      step("direct-answer", "DIRECT_ANSWER", "输出经营结论", "基于真实店铺数据回答。"),
    );
    return steps;
  }

  steps.push(step("direct-answer", "DIRECT_ANSWER", "直接回答", "不涉及实时店铺写操作时，直接给出建议。"));
  return steps;
}

function summarizeInput(input: unknown) {
  const item = asRecord(input);
  const parts = [
    stringValue(item.storeId) ? `storeId=${stringValue(item.storeId)}` : null,
    stringValue(item.offerId) ? `offerId=${stringValue(item.offerId)}` : null,
    numberValue(item.actionId) ? `actionId=${numberValue(item.actionId)}` : null,
    typeof item.refreshEvidence === "boolean" ? `refresh=${item.refreshEvidence}` : null,
    numberValue(item.actionCount) ? `动作数=${numberValue(item.actionCount)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function summarizeOutput(output: unknown) {
  const item = asRecord(output);
  const categories = stringArray(item.categories);
  const created = Array.isArray(item.created) ? item.created.length : null;
  const parts = [
    stringValue(item.storeName),
    numberValue(item.productCount) !== null ? `商品 ${numberValue(item.productCount)}` : null,
    numberValue(item.visibleProductCount) !== null ? `可见 ${numberValue(item.visibleProductCount)}` : null,
    numberValue(item.lowContentRatingCount) !== null ? `低分 ${numberValue(item.lowContentRatingCount)}` : null,
    numberValue(item.competitorCount) !== null ? `竞品 ${numberValue(item.competitorCount)}` : null,
    numberValue(item.analyzedProductCount) !== null ? `诊断 ${numberValue(item.analyzedProductCount)}` : null,
    numberValue(item.candidateCount) !== null ? `候选 ${numberValue(item.candidateCount)}` : null,
    created !== null ? `创建动作 ${created}` : null,
    categories.length ? `类目：${categories.slice(0, 3).join("、")}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function mapToolToStepId(toolName: string) {
  const map: Record<string, string> = {
    get_ozon_store_snapshot: "read-store",
    get_ozon_product_content: "read-product",
    diagnose_ozon_store: "diagnose-store",
    analyze_ozon_competitors: "collect-competitors",
    list_ozon_promotions: "list-promotions",
    get_ozon_promotion_candidates: "read-candidates",
    compile_promotion_policy: "compile-policy",
    propose_promotion_enrollment: "propose-enrollment",
    propose_content_draft: "create-actions",
    propose_product_mutation_actions: "create-actions",
  };
  return map[toolName] ?? null;
}

export function buildAgentExecutionTrace(params: {
  plan: AgentPlanStep[];
  toolCalls: ToolCallLike[];
  createdActionIds?: string[];
  runStatus?: "RUNNING" | "SUCCEEDED" | "FAILED";
}) {
  const callsByStepId = new Map<string, ToolCallLike>();
  for (const call of params.toolCalls) {
    const stepId = mapToolToStepId(call.name);
    if (!stepId) continue;
    callsByStepId.set(stepId, call);
  }

  let reachedFailure = false;
  return params.plan.map((planStep, index): AgentExecutionStep => {
    const call = callsByStepId.get(planStep.id);
    const isSyntheticStart = planStep.kind === "RECEIVE_TASK" || planStep.kind === "PLAN_TASK";
    const createsActions = planStep.kind === "CREATE_ACTIONS";
    const waitsForApproval = planStep.kind === "WAIT_FOR_APPROVAL";
    const directAnswer = planStep.kind === "DIRECT_ANSWER";

    if (call) {
      const failed = Boolean(call.error);
      reachedFailure = reachedFailure || failed;
      return {
        ...planStep,
        status: failed ? "failed" : "succeeded",
        startedAt: call.at,
        finishedAt: call.at,
        durationMs: null,
        toolName: call.name,
        inputSummary: summarizeInput(call.input),
        outputSummary: failed ? null : summarizeOutput(call.output),
        error: call.error ?? null,
      };
    }

    if (isSyntheticStart) {
      return {
        ...planStep,
        status: params.runStatus === "FAILED" && index > 0 ? "failed" : "succeeded",
        startedAt: params.toolCalls[0]?.at ?? null,
        finishedAt: params.toolCalls[0]?.at ?? null,
        durationMs: null,
        toolName: null,
        inputSummary: null,
        outputSummary: null,
        error: null,
      };
    }

    if (createsActions && (params.createdActionIds?.length ?? 0) > 0) {
      return {
        ...planStep,
        status: "succeeded",
        startedAt: params.toolCalls.at(-1)?.at ?? null,
        finishedAt: params.toolCalls.at(-1)?.at ?? null,
        durationMs: null,
        toolName: null,
        inputSummary: null,
        outputSummary: `创建待审批动作 ${params.createdActionIds?.length ?? 0} 条`,
        error: null,
      };
    }

    if (waitsForApproval && (params.createdActionIds?.length ?? 0) > 0) {
      return {
        ...planStep,
        status: "waiting",
        startedAt: params.toolCalls.at(-1)?.at ?? null,
        finishedAt: null,
        durationMs: null,
        toolName: null,
        inputSummary: null,
        outputSummary: "等待用户在待审批中心确认",
        error: null,
      };
    }

    if (directAnswer && params.runStatus === "SUCCEEDED" && !reachedFailure) {
      return {
        ...planStep,
        status: "succeeded",
        startedAt: params.toolCalls.at(-1)?.at ?? null,
        finishedAt: params.toolCalls.at(-1)?.at ?? null,
        durationMs: null,
        toolName: null,
        inputSummary: null,
        outputSummary: "已生成回复",
        error: null,
      };
    }

    return {
      ...planStep,
      status: reachedFailure ? "skipped" : "pending",
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      toolName: planStep.expectedTool ?? null,
      inputSummary: null,
      outputSummary: null,
      error: null,
    };
  });
}
