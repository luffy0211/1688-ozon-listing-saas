import type { AgentActionType } from "@saas/db";
import { env } from "../env";

export type AgentOperationKind = "mutation" | "recommendation";

export type ProfitGuardrailInput = {
  actionType: AgentActionType;
  proposedPriceRub?: number | null;
  costRub?: number | null;
  purchaseCostCny?: number | null;
  cnyToRub?: number | null;
  commissionRate?: number | null;
};

export type ProfitGuardrailResult = {
  allowed: boolean;
  reason: string | null;
  grossMarginRate: number | null;
  profitRub: number | null;
  costRub: number | null;
  minMarginRate: number;
  minProfitRub: number;
};

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(api[_-]?key|authorization|cookie|token|secret|password)["'\s:=]+[^,\s"']+/gi,
  /(Client-Id|Api-Key)\s*:\s*[^,\n]+/gi,
];

const MUTATION_ACTION_TYPES = new Set<AgentActionType>([
  "UPDATE_PRICE",
  "UPDATE_STOCK",
  "UPDATE_IMAGES",
  "UPDATE_ATTRIBUTES",
  "UPDATE_CATEGORY",
  "PUBLISH_DRAFT",
  "CONTENT_DRAFT",
  "ARCHIVE_PRODUCT",
  "UNARCHIVE_PRODUCT",
  "DELETE_PRODUCT",
  "BULK_PRODUCT_UPDATE",
]);

const RECOMMENDATION_ACTION_TYPES = new Set<AgentActionType>([
  "RESTOCK_RECOMMENDATION",
  "PROMO_RECOMMENDATION",
]);

export function getProfitGuardrails() {
  return {
    minMarginRate: Number.isFinite(env.agentMinMarginRate)
      ? env.agentMinMarginRate
      : 0.25,
    minProfitRub: Number.isFinite(env.agentMinProfitRub)
      ? env.agentMinProfitRub
      : 100,
    competitorCacheHours: Number.isFinite(env.agentCompetitorCacheHours)
      ? env.agentCompetitorCacheHours
      : 24,
  };
}

export function redactSensitiveText(value: string): string {
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[REDACTED]"),
    value,
  );
}

export function actionNeedsApproval(actionType: AgentActionType): boolean {
  return MUTATION_ACTION_TYPES.has(actionType);
}

export function isRecommendationOnly(actionType: AgentActionType): boolean {
  return RECOMMENDATION_ACTION_TYPES.has(actionType);
}

export function actionOperationKind(actionType: AgentActionType): AgentOperationKind {
  return actionNeedsApproval(actionType) ? "mutation" : "recommendation";
}

export function actionApprovalPolicy(actionType: AgentActionType) {
  const operationKind = actionOperationKind(actionType);
  return {
    operationKind,
    approvalRequired: operationKind === "mutation",
    readOnly: false,
    canExecuteWithoutApproval: false,
  };
}

export function evaluateProfitGuardrail(
  input: ProfitGuardrailInput,
): ProfitGuardrailResult {
  const guardrails = getProfitGuardrails();

  if (input.actionType !== "UPDATE_PRICE") {
    return {
      allowed: true,
      reason: null,
      grossMarginRate: null,
      profitRub: null,
      costRub: null,
      ...guardrails,
    };
  }

  const proposedPriceRub = input.proposedPriceRub ?? null;
  const cnyToRub = input.cnyToRub ?? 12;
  const costRub =
    input.costRub ??
    (input.purchaseCostCny == null ? null : input.purchaseCostCny * cnyToRub);
  const commissionRate = input.commissionRate ?? 0.15;

  if (!proposedPriceRub || proposedPriceRub <= 0) {
    return {
      allowed: false,
      reason: "missing_or_invalid_price",
      grossMarginRate: null,
      profitRub: null,
      costRub,
      ...guardrails,
    };
  }

  if (costRub == null || costRub <= 0) {
    return {
      allowed: false,
      reason: "missing_cost",
      grossMarginRate: null,
      profitRub: null,
      costRub,
      ...guardrails,
    };
  }

  const profitRub = proposedPriceRub - proposedPriceRub * commissionRate - costRub;
  const grossMarginRate = profitRub / proposedPriceRub;
  const allowed =
    profitRub >= guardrails.minProfitRub &&
    grossMarginRate >= guardrails.minMarginRate;

  return {
    allowed,
    reason: allowed ? null : "profit_guardrail_failed",
    grossMarginRate,
    profitRub,
    costRub,
    ...guardrails,
  };
}
