import type { SourceProductImport, SourceShopImport } from "./types";

export type ValidationIssue = {
  field: string;
  message: string;
};

export function validateProductImport(
  input: SourceProductImport,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input.offerId) issues.push({ field: "offerId", message: "缺少 offerId" });
  if (!input.sourceUrl)
    issues.push({ field: "sourceUrl", message: "缺少 sourceUrl" });
  if (!input.title) issues.push({ field: "title", message: "缺少商品标题" });
  if (!input.mainImages || input.mainImages.length === 0)
    issues.push({ field: "mainImages", message: "缺少主图" });
  if (input.skus.length > 0 && !input.skus[0]!.imageUrl)
    issues.push({ field: "skus", message: "SKU 缺少主图" });
  return issues;
}

export function validateShopImport(input: SourceShopImport): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input.shopName)
    issues.push({ field: "shopName", message: "缺少店铺名称" });
  if (!input.shopUrl)
    issues.push({ field: "shopUrl", message: "缺少店铺链接" });
  if (!input.products || input.products.length === 0)
    issues.push({ field: "products", message: "店铺商品列表为空" });
  return issues;
}
