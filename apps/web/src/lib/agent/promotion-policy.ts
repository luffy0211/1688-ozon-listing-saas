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

const priceFormulaVariableSchema = z.enum([
  "currentPrice",
  "maxActionPrice",
  "stock",
  "orders30d",
  "revenue30d",
  "ozonNetPayout",
  "contentRating",
  "cost",
  "logisticsFee",
  "commissionFee",
  "minProfit",
]);

export const promotionPriceRuleSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("multiplier"),
    value: z.number().finite().positive().max(1),
  }),
  z.strictObject({
    mode: z.literal("percent_off"),
    value: z.number().finite().min(0).max(0.99),
  }),
  z.strictObject({
    mode: z.literal("amount_off"),
    value: z.number().finite().positive(),
  }),
  z.strictObject({
    mode: z.literal("fixed"),
    value: z.number().finite().positive(),
  }),
  z.strictObject({
    mode: z.literal("ozon_max"),
  }),
  z.strictObject({
    mode: z.literal("formula"),
    expression: z.string().min(1).max(240),
    rounding: z.enum(["none", "round", "ceil", "floor"]).optional(),
    minGrossMarginRate: z.number().finite().min(0).max(0.99).optional(),
    minProfitRub: z.number().finite().min(0).optional(),
  }),
]);

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
export type PromotionPriceRule = z.infer<typeof promotionPriceRuleSchema>;
export type PromotionMetrics = z.infer<typeof promotionMetricsSchema>;
export type PromotionPriceValues = Partial<Record<z.infer<typeof priceFormulaVariableSchema>, number>>;

export type PromotionPolicyResult =
  | { passed: true; reason: null }
  | { passed: false; reason: string };

export type PromotionPriceResult =
  | { passed: true; actionPrice: number }
  | { passed: false; reason: string };

type FormulaTokenizeResult =
  | { passed: true; tokens: FormulaToken[] }
  | { passed: false; reason: string };

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundFormulaPrice(value: number, rounding: "none" | "round" | "ceil" | "floor" | undefined) {
  switch (rounding ?? "round") {
    case "ceil":
      return Math.ceil(value);
    case "floor":
      return Math.floor(value);
    case "round":
      return Math.round(value);
    case "none":
      return value;
  }
}

type FormulaToken =
  | { type: "number"; value: number }
  | { type: "variable"; value: keyof PromotionPriceValues }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "(" | ")" };

const formulaOperators = ["+", "-", "*", "/", "(", ")"] as const;
type FormulaOperator = (typeof formulaOperators)[number];

function tokenizeFormula(expression: string): FormulaTokenizeResult {
  const tokens: FormulaToken[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (!char) return { passed: false, reason: "invalid_formula_character" };
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = expression.slice(index).match(/^\d+(?:\.\d+)?|^\.\d+/);
      const rawNumber = match?.[0];
      if (!rawNumber) return { passed: false, reason: "invalid_formula_number" };
      tokens.push({ type: "number", value: Number(rawNumber) });
      index += rawNumber.length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      const rawVariable = match?.[0];
      if (!rawVariable) return { passed: false, reason: "invalid_formula_variable" };
      const parsed = priceFormulaVariableSchema.safeParse(rawVariable);
      if (!parsed.success) return { passed: false, reason: `unknown_formula_variable:${rawVariable}` };
      tokens.push({ type: "variable", value: parsed.data });
      index += rawVariable.length;
      continue;
    }
    if (formulaOperators.includes(char as FormulaOperator)) {
      tokens.push({ type: "operator", value: char as FormulaOperator });
      index += 1;
      continue;
    }
    return { passed: false, reason: "invalid_formula_character" };
  }
  return { passed: true, tokens };
}

function parseFormulaExpression(
  tokens: FormulaToken[],
  values: PromotionPriceValues,
): PromotionPriceResult {
  let index = 0;

  const peek = () => tokens[index];
  const consume = () => tokens[index++];

  const readVariable = (name: keyof PromotionPriceValues): PromotionPriceResult => {
    const value = values[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { passed: false, reason: `missing_formula_variable:${name}` };
    }
    return { passed: true, actionPrice: value };
  };

  const parseFactor = (): PromotionPriceResult => {
    const token = consume();
    if (!token) return { passed: false, reason: "invalid_formula_syntax" };
    if (token.type === "number") return { passed: true, actionPrice: token.value };
    if (token.type === "variable") return readVariable(token.value);
    if (token.type === "operator" && token.value === "-") {
      const nested = parseFactor();
      return nested.passed
        ? { passed: true, actionPrice: -nested.actionPrice }
        : nested;
    }
    if (token.type === "operator" && token.value === "+") return parseFactor();
    if (token.type === "operator" && token.value === "(") {
      const nested = parseExpression();
      if (!nested.passed) return nested;
      const closing = consume();
      if (closing?.type !== "operator" || closing.value !== ")") {
        return { passed: false, reason: "invalid_formula_parentheses" };
      }
      return nested;
    }
    return { passed: false, reason: "invalid_formula_syntax" };
  };

  const parseTerm = (): PromotionPriceResult => {
    let left = parseFactor();
    while (left.passed && peek()?.type === "operator" && ["*", "/"].includes(String(peek()?.value))) {
      const operator = consume() as Extract<FormulaToken, { type: "operator" }>;
      const right = parseFactor();
      if (!right.passed) return right;
      if (operator.value === "/" && right.actionPrice === 0) {
        return { passed: false, reason: "formula_divide_by_zero" };
      }
      left = {
        passed: true,
        actionPrice: operator.value === "*"
          ? left.actionPrice * right.actionPrice
          : left.actionPrice / right.actionPrice,
      };
    }
    return left;
  };

  const parseExpression = (): PromotionPriceResult => {
    let left = parseTerm();
    while (left.passed && peek()?.type === "operator" && ["+", "-"].includes(String(peek()?.value))) {
      const operator = consume() as Extract<FormulaToken, { type: "operator" }>;
      const right = parseTerm();
      if (!right.passed) return right;
      left = {
        passed: true,
        actionPrice: operator.value === "+"
          ? left.actionPrice + right.actionPrice
          : left.actionPrice - right.actionPrice,
      };
    }
    return left;
  };

  const result = parseExpression();
  if (!result.passed) return result;
  if (index !== tokens.length) return { passed: false, reason: "invalid_formula_syntax" };
  return Number.isFinite(result.actionPrice)
    ? result
    : { passed: false, reason: "invalid_formula_result" };
}

function formulaProfit(
  values: PromotionPriceValues,
  actionPrice: number,
): PromotionPriceResult {
  for (const field of ["cost", "logisticsFee", "commissionFee"] as const) {
    const value = values[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { passed: false, reason: `missing_formula_variable:${field}` };
    }
  }
  return {
    passed: true,
    actionPrice: actionPrice - values.cost! - values.logisticsFee! - values.commissionFee!,
  };
}

export function calculatePromotionActionPrice(
  rule: PromotionPriceRule,
  values: PromotionPriceValues,
): PromotionPriceResult {
  const currentPrice = values.currentPrice ?? 0;
  const maxActionPrice = values.maxActionPrice ?? 0;
  let actionPrice: PromotionPriceResult;

  switch (rule.mode) {
    case "multiplier":
      actionPrice = { passed: true, actionPrice: currentPrice * rule.value };
      break;
    case "percent_off":
      actionPrice = { passed: true, actionPrice: currentPrice * (1 - rule.value) };
      break;
    case "amount_off":
      actionPrice = { passed: true, actionPrice: currentPrice - rule.value };
      break;
    case "fixed":
      actionPrice = { passed: true, actionPrice: rule.value };
      break;
    case "ozon_max":
      actionPrice = { passed: true, actionPrice: maxActionPrice };
      break;
    case "formula": {
      const tokens = tokenizeFormula(rule.expression);
      if (!tokens.passed) return tokens;
      actionPrice = parseFormulaExpression(tokens.tokens, values);
      if (!actionPrice.passed) return actionPrice;
      actionPrice = {
        passed: true,
        actionPrice: roundFormulaPrice(actionPrice.actionPrice, rule.rounding),
      };
      if (rule.minProfitRub !== undefined || rule.minGrossMarginRate !== undefined) {
        const profit = formulaProfit(values, actionPrice.actionPrice);
        if (!profit.passed) return profit;
        if (rule.minProfitRub !== undefined && profit.actionPrice < rule.minProfitRub) {
          return { passed: false, reason: "formula_min_profit_failed" };
        }
        if (
          rule.minGrossMarginRate !== undefined &&
          actionPrice.actionPrice > 0 &&
          profit.actionPrice / actionPrice.actionPrice < rule.minGrossMarginRate
        ) {
          return { passed: false, reason: "formula_min_margin_failed" };
        }
      }
      break;
    }
  }

  return {
    passed: true,
    actionPrice: roundMoney(actionPrice.actionPrice),
  };
}

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
