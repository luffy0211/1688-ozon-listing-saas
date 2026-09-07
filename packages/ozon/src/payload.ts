import { createHash } from "node:crypto";
import type {
  OzonAttribute,
  OzonDraftInput,
  OzonProductPayload,
} from "./types";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function positiveInt(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return Math.ceil(value);
}

export function wireAttributes(attributes: OzonAttribute[]): OzonProductPayload["attributes"] {
  return attributes.map((attribute) => ({
    id: attribute.id,
    values: attribute.values.map((value) => ({
      value: value.value,
      ...(value.dictionaryValueId ?? value.dictionary_value_id
        ? { dictionary_value_id: value.dictionaryValueId ?? value.dictionary_value_id }
        : {}),
    })),
  }));
}

/**
 * 把 Ozon 草稿编译成 /v3/product/import 的 item payload。
 * 该 payload 永远不包含库存/仓库字段。
 */
export function compileOzonPayload(input: OzonDraftInput): OzonProductPayload {
  if (!Number.isFinite(input.priceRub) || input.priceRub <= 0) {
    throw new Error("price must be a positive number");
  }
  if (input.attributes.length === 0) {
    throw new Error("attributes must not be empty");
  }
  const images = uniqueStrings([...input.mainImages, ...input.detailImages]);
  if (images.length === 0) {
    throw new Error("images must not be empty");
  }

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
    description_category_id: positiveInt(input.descriptionCategoryId, "description_category_id"),
    type_id: positiveInt(input.typeId, "type_id"),
    price: String(input.priceRub),
    old_price: String(input.priceRub),
    vat: "0",
    currency_code: input.currencyCode ?? "RUB",
    images,
    attributes: wireAttributes(input.attributes),
    weight: positiveInt(input.weightGrams, "weight"),
    width: positiveInt(input.dimensions.widthMm, "width"),
    height: positiveInt(input.dimensions.heightMm, "height"),
    depth: positiveInt(input.dimensions.depthMm, "depth"),
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
