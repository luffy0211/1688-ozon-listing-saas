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

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const IMPORT_ITEMS_PATH = "items";

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

function isPositiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function collectCjkStrings(obj: unknown, path = ""): string[] {
  const found: string[] = [];
  if (typeof obj === "string") {
    if (CJK_RE.test(obj)) found.push(path || "$");
  } else if (Array.isArray(obj)) {
    obj.forEach((value, index) => {
      found.push(...collectCjkStrings(value, `${path}[${index}]`));
    });
  } else if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      found.push(...collectCjkStrings(value, path ? `${path}.${key}` : key));
    }
  }
  return found;
}

function importItems(payload: unknown): Record<string, unknown>[] {
  const root = recordValue(payload);
  const rawItems = Array.isArray(root.items) ? root.items : [payload];
  return rawItems.map(recordValue).filter((item) => Object.keys(item).length > 0);
}

function checkImportItemShape(payload: unknown): string[] {
  const failures: string[] = [];
  const items = importItems(payload);
  if (items.length === 0) return [`${IMPORT_ITEMS_PATH} 为空`];

  items.forEach((item, index) => {
    const prefix = items.length === 1 ? "payload" : `items[${index}]`;
    if (!isPositiveNumber(item.description_category_id)) {
      failures.push(`${prefix} 缺少有效 description_category_id`);
    }
    if (!isPositiveNumber(item.type_id)) {
      failures.push(`${prefix} 缺少有效 type_id`);
    }
    if (!Array.isArray(item.attributes) || item.attributes.length === 0) {
      failures.push(`${prefix} attributes 为空`);
    }
    const images = Array.isArray(item.images) ? item.images : [];
    if (!images.length || images.some((url) => !stringValue(url).startsWith("https://"))) {
      failures.push(`${prefix} 图片必须是 HTTPS 公网链接`);
    }
    for (const field of ["weight", "width", "height", "depth"]) {
      if (!isPositiveNumber(item[field])) failures.push(`${prefix} ${field} 必须大于 0`);
    }
  });

  return failures;
}

export function checkSubmitGuards(input: SubmitGuardInput): GuardResult {
  const failures: string[] = [];

  if (!input.hasOzonCredentials) failures.push("缺少 Ozon 店铺密钥");
  if (!input.hasXiangjiKey) failures.push("缺少象寄 X-API-Key");
  if (!input.hasMainImage) failures.push("缺少 SKU 主图");
  if (!input.hasDetailImage) failures.push("缺少详情图");
  if (!input.hasPrice) failures.push("缺少价格");
  failures.push(...checkImportItemShape(input.payload));

  const stockFields = collectStockFields(input.payload);
  if (stockFields.length > 0) {
    failures.push(`payload 含库存字段: ${stockFields.join(", ")}`);
  }
  const cjkFields = collectCjkStrings(input.payload);
  if (cjkFields.length > 0) {
    failures.push(`payload 含中文字段: ${cjkFields.join(", ")}`);
  }

  if (input.duplicateSubmission) {
    failures.push("同店铺同 request_hash 已提交，禁止重复提交");
  }

  return { ok: failures.length === 0, failures };
}
