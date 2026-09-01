import { createHash } from "node:crypto";

/**
 * 店铺跟随（方案.md 第 9 节）：
 * 第一版只跟随新品。offerId 首次出现 → new；已存在 → known。
 */

export type SnapshotDiff<T> = {
  newProducts: T[];
  knownProducts: T[];
};

/** 按 offerId 去重，区分新品与已存在商品。 */
export function diffShopProducts<T extends { offerId: string }>(
  prevOfferIds: ReadonlySet<string>,
  incoming: T[],
): SnapshotDiff<T> {
  const newProducts: T[] = [];
  const knownProducts: T[] = [];
  const seen = new Set<string>();

  for (const p of incoming) {
    if (seen.has(p.offerId)) continue; // 同批去重
    seen.add(p.offerId);
    if (prevOfferIds.has(p.offerId)) {
      knownProducts.push(p);
    } else {
      newProducts.push(p);
    }
  }
  return { newProducts, knownProducts };
}

/** 店铺商品快照 hash：用于判断新品与变化。 */
export function snapshotHash(fields: {
  offerId: string;
  title?: string;
  priceText?: string;
  url?: string;
}): string {
  const raw = `${fields.offerId}|${fields.title ?? ""}|${fields.priceText ?? ""}|${fields.url ?? ""}`;
  return createHash("sha256").update(raw).digest("hex");
}

export const FOLLOW_STATUS = {
  NEW: "NEW",
  KNOWN: "KNOWN",
  IMPORTED_TO_PRODUCT_POOL: "IMPORTED_TO_PRODUCT_POOL",
  IGNORED: "IGNORED",
  NOT_SEEN_IN_LATEST_SYNC: "NOT_SEEN_IN_LATEST_SYNC",
} as const;

export type FollowStatus = (typeof FOLLOW_STATUS)[keyof typeof FOLLOW_STATUS];
