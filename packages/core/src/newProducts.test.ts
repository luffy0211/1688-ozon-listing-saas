import { describe, expect, it } from "vitest";
import { diffShopProducts } from "./newProducts";

describe("diffShopProducts", () => {
  it("deduplicates incoming offers and separates new from known", () => {
    const result = diffShopProducts(new Set(["1001"]), [
      { offerId: "1001", title: "known" },
      { offerId: "1002", title: "new" },
      { offerId: "1002", title: "duplicate" },
    ]);

    expect(result.knownProducts).toEqual([{ offerId: "1001", title: "known" }]);
    expect(result.newProducts).toEqual([{ offerId: "1002", title: "new" }]);
  });
});
