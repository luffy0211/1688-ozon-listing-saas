import { createHash } from "node:crypto";
import type {
  OzonDraftInput,
  OzonProductPayload,
} from "./types";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

/**
 * 把 Ozon 草稿编译成 /v3/product/import 的 item payload。
 * 该 payload 永远不包含库存/仓库字段。
 */
export function compileOzonPayload(input: OzonDraftInput): OzonProductPayload {
  const description = [
    ...input.bulletPointsRu.map((p) => `• ${p}`),
    input.descriptionRu,
  ]
    .filter((s) => s && s.trim().length > 0)
    .join("\n");

  return {
    offer_id: input.offerId,
    name: input.titleRu,
    description,
    category_id: input.categoryId,
    price: String(input.priceRub),
    old_price: String(input.priceRub),
    vat: "0",
    currency_code: "RUB",
    images: uniqueStrings([...input.mainImages, ...input.detailImages]),
    attributes: input.attributes,
    weight: input.weightGrams ?? 0,
    width: input.dimensions?.widthMm ?? 0,
    height: input.dimensions?.heightMm ?? 0,
    depth: input.dimensions?.depthMm ?? 0,
    dimension_unit: "mm",
    weight_unit: "g",
  };
}

/** 提交请求 hash：同一店铺同一 payload 的幂等标识，防重复提交。 */
export function computeRequestHash(
  storeId: string,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(`${storeId}|${JSON.stringify(payload)}`)
    .digest("hex");
}
