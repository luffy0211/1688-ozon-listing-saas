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
      descriptionCategoryId: 1,
      typeId: 2,
      attributes: [{ id: 85, values: [{ value: "Нет бренда", dictionaryValueId: 971082156 }] }],
      priceRub: 1960,
      mainImages: ["https://img.test/main.jpg", "https://img.test/sku.jpg"],
      detailImages: ["https://img.test/sku.jpg", "https://img.test/detail.jpg"],
      weightGrams: 100,
      dimensions: { widthMm: 100, heightMm: 100, depthMm: 100 },
    });

    expect(payload.description_category_id).toBe(1);
    expect(payload.type_id).toBe(2);
    expect(payload.attributes).toEqual([
      { id: 85, values: [{ value: "Нет бренда", dictionary_value_id: 971082156 }] },
    ]);
    expect(payload.images).toEqual([
      "https://img.test/main.jpg",
      "https://img.test/sku.jpg",
      "https://img.test/detail.jpg",
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/stock|warehouse|inventory/i);
  });

  it("rejects placeholder category, empty attributes, and zero measurements", () => {
    expect(() =>
      compileOzonPayload({
        offerId: "offer-1",
        titleRu: "title",
        bulletPointsRu: [],
        descriptionRu: "description",
        searchKeywordsRu: "",
        descriptionCategoryId: 0,
        typeId: 0,
        attributes: [],
        priceRub: 1960,
        mainImages: ["https://img.test/main.jpg"],
        detailImages: [],
        weightGrams: 0,
        dimensions: { widthMm: 0, heightMm: 0, depthMm: 0 },
      }),
    ).toThrow("attributes must not be empty");
  });
});
