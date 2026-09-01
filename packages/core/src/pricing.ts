export type PricingRuleInput = {
  purchaseCny: number;
  domesticShippingCny: number;
  packagingCny: number;
  cnyToRub: number;
  internationalShippingRub: number;
  commissionRate: number; // 0..1
  targetMarginRate: number; // 0..1
};

/** 向上取整到 10。 */
export function ceilTo10(value: number): number {
  return Math.ceil(value / 10) * 10;
}

/**
 * 定价公式（方案.md 第 18 节）：
 *   base_cost_rub = (purchase + domestic + packaging) * cny_to_rub + international
 *   sale_price_rub = ceil_to_10(base_cost_rub / (1 - commission - margin))
 */
export function computeSalePriceRub(input: PricingRuleInput): number {
  const {
    purchaseCny,
    domesticShippingCny,
    packagingCny,
    cnyToRub,
    internationalShippingRub,
    commissionRate,
    targetMarginRate,
  } = input;

  const baseCostRub =
    (purchaseCny + domesticShippingCny + packagingCny) * cnyToRub +
    internationalShippingRub;

  if (baseCostRub < 0) {
    throw new Error("成本不能为负");
  }

  const denominator = 1 - commissionRate - targetMarginRate;
  if (denominator <= 0) {
    throw new Error("佣金率与目标毛利率之和必须小于 1");
  }

  return ceilTo10(baseCostRub / denominator);
}

/** 把定价规则（数据库 Decimal 常被序列化为字符串）规整成数字。 */
export function normalizePricingInput(
  input: Partial<Record<keyof PricingRuleInput, number | string | null | undefined>>,
): PricingRuleInput {
  const num = (v: number | string | null | undefined, dflt: number): number => {
    if (v === null || v === undefined || v === "") return dflt;
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : dflt;
  };
  return {
    purchaseCny: num(input.purchaseCny, 0),
    domesticShippingCny: num(input.domesticShippingCny, 0),
    packagingCny: num(input.packagingCny, 0),
    cnyToRub: num(input.cnyToRub, 12),
    internationalShippingRub: num(input.internationalShippingRub, 0),
    commissionRate: num(input.commissionRate, 0.15),
    targetMarginRate: num(input.targetMarginRate, 0.2),
  };
}
