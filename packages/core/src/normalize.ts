import type {
  NormalizedProductFact,
  Estimate,
  SourceProductImport,
} from "./types";

/**
 * 把 1688 采集的原始商品标准化为"商品事实"。
 * 规则（方案.md 第 17 节）：
 * - 不虚构材质/认证/承重/品牌/功能/配件数量；
 * - 品牌默认"无品牌"；
 * - 估算字段必须带 estimated 和 confidence。
 */

const DEFAULT_BRAND = "无品牌";

function estimatePurchase(
  tiers: SourceProductImport["priceTiers"],
): Estimate<number> {
  if (tiers.length === 0) {
    return { value: 0, estimated: true, confidence: 0 };
  }
  const sorted = [...tiers].sort((a, b) => a.priceCny - b.priceCny);
  // 取价格摘要里最低档作为采购价估算，非真实成交价，故 estimated=true
  return { value: sorted[0]!.priceCny, estimated: true, confidence: 0.8 };
}

export function normalizeProduct(
  input: SourceProductImport,
): NormalizedProductFact {
  return {
    title: input.title,
    categoryPath: input.categoryPath ?? [],
    // 品牌默认"无品牌"，不是估算，而是明确默认值
    brand: { value: DEFAULT_BRAND, estimated: false, confidence: 1 },
    properties: input.properties.map((p) => ({
      name: p.name,
      value: p.value,
      estimated: false,
      confidence: 1,
    })),
    priceTiers: input.priceTiers,
    skus: input.skus.map((s) => ({ ...s })),
    purchaseCny: estimatePurchase(input.priceTiers),
    mainImages: input.mainImages,
    detailImages: input.detailImages,
    descriptionText: input.descriptionText,
    logistics: input.logistics,
  };
}
