import { z } from "zod";

const fieldSchema = z.enum([
  "stock",
  "currentPrice",
  "actionPrice",
  "maxActionPrice",
  "discountRate",
  "orders30d",
  "revenue30d",
  "ozonNetPayout",
  "contentRating",
]);

const conditionSchema = z.discriminatedUnion("operator", [
  z.strictObject({
    field: fieldSchema,
    operator: z.enum(["gte", "lte", "eq"]),
    value: z.number().finite(),
  }),
  z.strictObject({
    field: fieldSchema,
    operator: z.enum(["in", "not_in"]),
    value: z.array(z.number().finite()).min(1),
  }),
]);

export const promotionPolicySchema = z.strictObject({
  all: z.array(conditionSchema).min(1).max(12),
});

const promotionMetricsSchema = z.strictObject({
  stock: z.number().finite().optional(),
  currentPrice: z.number().finite().optional(),
  actionPrice: z.number().finite().optional(),
  maxActionPrice: z.number().finite().optional(),
  discountRate: z.number().finite().optional(),
  orders30d: z.number().finite().optional(),
  revenue30d: z.number().finite().optional(),
  ozonNetPayout: z.number().finite().optional(),
  contentRating: z.number().finite().optional(),
});

export type PromotionPolicy = z.infer<typeof promotionPolicySchema>;
export type PromotionMetrics = z.infer<typeof promotionMetricsSchema>;

export type PromotionPolicyResult =
  | { passed: true; reason: null }
  | { passed: false; reason: string };

function matches(
  condition: PromotionPolicy["all"][number],
  metric: number,
): boolean {
  switch (condition.operator) {
    case "gte":
      return metric >= condition.value;
    case "lte":
      return metric <= condition.value;
    case "eq":
      return metric === condition.value;
    case "in":
      return condition.value.includes(metric);
    case "not_in":
      return !condition.value.includes(metric);
  }
}

export function evaluate(
  rule: unknown,
  metrics: unknown,
): PromotionPolicyResult {
  const parsedRule = promotionPolicySchema.safeParse(rule);
  if (!parsedRule.success) return { passed: false, reason: "invalid_rule" };

  const parsedMetrics = promotionMetricsSchema.safeParse(metrics);
  if (!parsedMetrics.success) {
    return { passed: false, reason: "invalid_metrics" };
  }

  for (const condition of parsedRule.data.all) {
    const metric = parsedMetrics.data[condition.field];
    if (metric === undefined) {
      return { passed: false, reason: `missing_metric:${condition.field}` };
    }
    if (!matches(condition, metric)) {
      return {
        passed: false,
        reason: `condition_failed:${condition.field}:${condition.operator}`,
      };
    }
  }

  return { passed: true, reason: null };
}
