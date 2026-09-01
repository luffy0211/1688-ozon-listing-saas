import type {
  ImportProductsRequest,
  ImportProductsResult,
} from "./types";

/**
 * mock Ozon 提交：ENABLE_REAL_OZON_SUBMIT=false 时使用。
 * 返回一个假的 task_id，绝不调用真实 Ozon。
 */
export function mockImportProducts(
  _payload: ImportProductsRequest,
): ImportProductsResult {
  const taskId =
    1_000_000 + Math.floor(Math.random() * 8_999_999);
  return { task_id: taskId };
}
