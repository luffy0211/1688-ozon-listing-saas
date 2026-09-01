/**
 * 商品上架流水线固定步骤（方案.md 第 13 节）。
 * web 创建 job_steps，worker 按顺序执行，失败可从失败步骤重试。
 */
export const PIPELINE_STEPS = [
  "validate_import",
  "download_assets",
  "normalize_product_facts",
  "translate_product_info",
  "match_ozon_category",
  "generate_ozon_content",
  "generate_pricing",
  "qc_check",
  "compile_ozon_payload",
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];
