import { describe, expect, it } from "vitest";
import { mutationTarget } from "./mutation-target";

describe("mutation target binding", () => {
  const read: [{ offerId: string; productId: string }, { offerId: string; productId: string }] =
    [{ offerId: "A", productId: "1" }, { offerId: "B", productId: "2" }];
  it("does not carry the last product ID into a different offer", () => {
    expect(mutationTarget({ offerId: "A" }, read, read[1])).toEqual(read[0]);
    expect(mutationTarget({ offerId: "C" }, read, read[1])).toEqual({ offerId: "C", productId: null });
  });
  it("rejects conflicting explicit identifiers", () => {
    expect(() => mutationTarget({ offerId: "A", productId: "2" }, read, read[1])).toThrow("product_identity_mismatch");
  });
  it("does not infer an unrelated offer for a product-ID-only task", () => {
    expect(mutationTarget({ productId: "3" }, read, read[1])).toEqual({ offerId: null, productId: "3" });
    expect(mutationTarget({ productId: "1" }, read, read[1])).toEqual(read[0]);
  });
});
