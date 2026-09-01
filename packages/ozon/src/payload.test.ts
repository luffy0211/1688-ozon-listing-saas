import { describe, expect, it } from "vitest";
import { compileOzonPayload } from "./payload";

describe("compileOzonPayload", () => {
  it("deduplicates images and keeps stock out of the import payload", () => {
    const payload = compileOzonPayload({
      offerId: "offer-1",
      titleRu: "title",
      bulletPointsRu: ["material: polyester"],
      descriptionRu: "description",
      searchKeywordsRu: "",
      categoryId: 1,
      attributes: [],
      priceRub: 1960,
      mainImages: ["https://img.test/main.jpg", "https://img.test/sku.jpg"],
      detailImages: ["https://img.test/sku.jpg", "https://img.test/detail.jpg"],
    });

    expect(payload.images).toEqual([
      "https://img.test/main.jpg",
      "https://img.test/sku.jpg",
      "https://img.test/detail.jpg",
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/stock|warehouse|inventory/i);
  });
});
