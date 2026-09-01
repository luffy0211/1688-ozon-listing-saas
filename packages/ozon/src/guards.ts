/**
 * Ozon 提交硬门禁（方案.md 第 19 节）。
 * 任一失败即禁止提交。
 */

export type SubmitGuardInput = {
  hasOzonCredentials: boolean;
  hasXiangjiKey: boolean;
  hasMainImage: boolean;
  hasDetailImage: boolean;
  hasPrice: boolean;
  payload: unknown;
  duplicateSubmission: boolean;
};

export type GuardResult = {
  ok: boolean;
  failures: string[];
};

const STOCK_KEYS = new Set([
  "stock",
  "stocks",
  "available",
  "availability",
  "quantity",
  "inventory",
  "warehouse",
  "warehouses",
  "supply",
]);

/** 递归收集 payload 中出现的库存/仓库字段键名。 */
export function collectStockFields(
  obj: unknown,
  path = "",
): string[] {
  const found: string[] = [];
  if (Array.isArray(obj)) {
    obj.forEach((v, i) =>
      found.push(...collectStockFields(v, `${path}[${i}]`)),
    );
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${k}` : k;
      if (STOCK_KEYS.has(k.toLowerCase())) found.push(fullPath);
      found.push(...collectStockFields(v, fullPath));
    }
  }
  return found;
}

export function checkSubmitGuards(input: SubmitGuardInput): GuardResult {
  const failures: string[] = [];

  if (!input.hasOzonCredentials) failures.push("缺少 Ozon 店铺密钥");
  if (!input.hasXiangjiKey) failures.push("缺少象寄 X-API-Key");
  if (!input.hasMainImage) failures.push("缺少 SKU 主图");
  if (!input.hasDetailImage) failures.push("缺少详情图");
  if (!input.hasPrice) failures.push("缺少价格");

  const stockFields = collectStockFields(input.payload);
  if (stockFields.length > 0) {
    failures.push(`payload 含库存字段: ${stockFields.join(", ")}`);
  }

  if (input.duplicateSubmission) {
    failures.push("同店铺同 request_hash 已提交，禁止重复提交");
  }

  return { ok: failures.length === 0, failures };
}
