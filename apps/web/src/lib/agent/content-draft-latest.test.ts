import { describe, expect, it } from "vitest";

import { contentDraftImportPayload } from "./actions";

describe("content draft latest product merge", () => {
  it("preserves fields changed in Ozon after the draft was created", () => {
    const action = {
      offerId: "SKU-1",
      payloadJson: {
        suggestions: [{ field: "title", suggestedRu: "Approved new title" }],
        product: {
          rawInfo: {
            offer_id: "SKU-1",
            name: "Old title",
            description: "Old description",
            description_category_id: 10,
            type_id: 20,
            price: "100",
            old_price: "120",
            currency_code: "RUB",
            images: ["old.jpg"],
            attributes: [{ id: 4191, values: [{ value: "Old description" }] }],
            weight: 100,
            width: 10,
            height: 20,
            depth: 30,
          },
        },
      },
    };

    const result = contentDraftImportPayload(action, {
      offer_id: "SKU-1",
      name: "Title changed directly in Ozon",
      description: "Description changed directly in Ozon",
      description_category_id: 10,
      type_id: 20,
      price: "150",
      old_price: "170",
      currency_code: "RUB",
      images: ["latest.jpg"],
      attributes: [{ id: 4191, values: [{ value: "Description changed directly in Ozon" }] }],
      weight: 110,
      width: 11,
      height: 21,
      depth: 31,
    });

    expect(result.request.items[0]).toMatchObject({
      name: "Approved new title",
      description: "Description changed directly in Ozon",
      price: "150",
      old_price: "170",
      images: ["latest.jpg"],
      weight: 110,
      width: 11,
      height: 21,
      depth: 31,
    });
  });
});
