import { describe, expect, it } from "vitest";
import {
  buildCategoryAttributePlaybook,
  buildProductAttributeRecommendations,
  parseCategoryAttributePlaybook,
} from "./competitor-playbook";

const categoryAttributes = [
  {
    id: 10,
    name: "Материал",
    description: "",
    type: "String",
    is_collection: false,
    is_required: false,
    dictionary_id: 100,
  },
  {
    id: 20,
    name: "Сезон",
    description: "",
    type: "String",
    is_collection: false,
    is_required: true,
    dictionary_id: 200,
  },
  {
    id: 30,
    name: "Цвет товара",
    description: "",
    type: "String",
    is_collection: false,
    is_required: true,
  },
];

describe("Ozon competitor attribute playbook", () => {
  it("maps competitor names and values to official Ozon identifiers", () => {
    const playbook = buildCategoryAttributePlaybook({
      descriptionCategoryId: 17027904,
      typeId: 93337,
      categoryName: "Мужское поло",
      categoryAttributes,
      dictionaryValues: new Map([
        [10, [{ id: 1001, value: "Хлопок" }]],
        [20, [{ id: 2001, value: "Лето" }]],
      ]),
      competitors: [
        {
          url: "https://www.ozon.ru/product/1/",
          attributes: { Материал: "Хлопок", Сезон: "Лето" },
          description: "Хлопковое поло для лета.",
        },
        {
          url: "https://www.ozon.ru/product/2/",
          attributes: { материал: "Хлопок", Сезон: "Лето" },
          description: null,
        },
      ],
      capturedAt: "2026-09-07T00:00:00.000Z",
    });

    expect(playbook).toMatchObject({
      kind: "category_attribute_playbook",
      schemaVersion: 1,
      categoryKey: "17027904:93337",
      sampleSize: 2,
      descriptionPatterns: { availableCount: 1 },
    });
    expect(playbook.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        competitorNameRu: "Материал",
        ozonAttributeId: 10,
        ozonNameRu: "Материал",
        coverageCount: 2,
        coverageRate: 1,
        mappingStatus: "EXACT",
        commonValues: [expect.objectContaining({
          value: "Хлопок",
          count: 2,
          rate: 1,
          dictionaryValueId: 1001,
        })],
        evidenceUrls: [
          "https://www.ozon.ru/product/1/",
          "https://www.ozon.ru/product/2/",
        ],
      }),
      expect.objectContaining({
        competitorNameRu: "Цвет товара",
        ozonAttributeId: 30,
        required: true,
        coverageCount: 0,
      }),
    ]));
    expect(parseCategoryAttributePlaybook(playbook)).toEqual(playbook);
    expect(parseCategoryAttributePlaybook({ ...playbook, categoryKey: "wrong" })).toBeNull();
    expect(parseCategoryAttributePlaybook({
      ...playbook,
      attributes: [{ ...playbook.attributes[0], commonValues: [{ value: 123 }] }],
    })).toBeNull();
  });

  it("only proposes values supported by the own product content", () => {
    const playbook = buildCategoryAttributePlaybook({
      descriptionCategoryId: 17027904,
      typeId: 93337,
      categoryName: "Мужское поло",
      categoryAttributes,
      dictionaryValues: new Map([
        [10, [{ id: 1001, value: "Хлопок" }]],
        [20, [{ id: 2001, value: "Лето" }]],
      ]),
      competitors: [
        {
          url: "https://www.ozon.ru/product/1/",
          attributes: { Материал: "Хлопок", Сезон: "Лето" },
          description: null,
        },
        {
          url: "https://www.ozon.ru/product/2/",
          attributes: { Материал: "Хлопок", Сезон: "Лето" },
          description: null,
        },
        {
          url: "https://www.ozon.ru/product/3/",
          attributes: { Материал: "Хлопок", Сезон: "Лето" },
          description: null,
        },
      ],
    });
    const result = buildProductAttributeRecommendations({
      playbook,
      product: {
        offer_id: "offer-1",
        product_id: 44,
        name: "Мужское поло из хлопка",
        description: "Базовая модель из материала Хлопок.",
        description_category_id: 17027904,
        type_id: 93337,
        attributes: [{ id: 30, values: [{ value: "Синий" }] }],
      },
    });

    expect(result.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ozonAttributeId: 10,
        status: "ADD",
        suggestedValue: "Хлопок",
        dictionaryValueId: 1001,
        evidenceSource: "OWN_CONTENT",
      }),
      expect.objectContaining({
        ozonAttributeId: 20,
        status: "NEEDS_CONFIRMATION",
        suggestedValue: "Лето",
        evidenceSource: "COMPETITOR_ONLY",
      }),
      expect.objectContaining({
        ozonAttributeId: 30,
        status: "COMPLETE",
        currentValues: ["Синий"],
      }),
    ]));
    expect(result.actionableCount).toBe(1);
    expect(result.actionAttributes).toEqual([
      { id: 10, values: [{ value: "Хлопок", dictionaryValueId: 1001 }] },
    ]);
  });

  it("does not create an actionable addition from fewer than three samples", () => {
    const playbook = buildCategoryAttributePlaybook({
      descriptionCategoryId: 1,
      typeId: 2,
      categoryName: "Рубашки",
      categoryAttributes: [categoryAttributes[0]!],
      dictionaryValues: new Map([[10, [{ id: 1001, value: "Хлопок" }]]]),
      competitors: [
        { url: "https://www.ozon.ru/product/1/", attributes: { Материал: "Хлопок" }, description: null },
        { url: "https://www.ozon.ru/product/2/", attributes: { Материал: "Хлопок" }, description: null },
      ],
    });

    const result = buildProductAttributeRecommendations({
      playbook,
      product: {
        offer_id: "offer-low-evidence",
        description_category_id: 1,
        type_id: 2,
        name: "Рубашка, материал Хлопок",
        attributes: [],
      },
    });

    expect(result.actionableCount).toBe(0);
    expect(result.actionAttributes).toBeNull();
    expect(result.recommendations[0]).toMatchObject({ status: "NEEDS_CONFIRMATION" });
  });

  it("does not replace a populated own attribute with the competitor majority", () => {
    const playbook = buildCategoryAttributePlaybook({
      descriptionCategoryId: 1,
      typeId: 2,
      categoryName: "Рубашки",
      categoryAttributes: [categoryAttributes[0]!],
      competitors: [
        { url: "https://www.ozon.ru/product/1/", attributes: { Материал: "Хлопок" }, description: null },
        { url: "https://www.ozon.ru/product/2/", attributes: { Материал: "Хлопок" }, description: null },
      ],
    });
    const result = buildProductAttributeRecommendations({
      playbook,
      product: {
        offer_id: "offer-2",
        description_category_id: 1,
        type_id: 2,
        attributes: [{ id: 10, values: [{ value: "Лен" }] }],
      },
    });

    expect(result.recommendations[0]).toMatchObject({
      status: "COMPLETE",
      currentValues: ["Лен"],
    });
    expect(result.actionableCount).toBe(0);
    expect(result.actionAttributes).toBeNull();
  });

  it("requires a complete own-content value match instead of a word fragment", () => {
    const playbook = buildCategoryAttributePlaybook({
      descriptionCategoryId: 1,
      typeId: 2,
      categoryName: "Рубашки",
      categoryAttributes: [categoryAttributes[1]!],
      dictionaryValues: new Map([[20, [{ id: 2001, value: "Лето" }]]]),
      competitors: [
        { url: "https://www.ozon.ru/product/1/", attributes: { Сезон: "Лето" }, description: null },
      ],
    });
    const result = buildProductAttributeRecommendations({
      playbook,
      product: {
        offer_id: "offer-3",
        description_category_id: 1,
        type_id: 2,
        name: "Рубашка для прогулок летом",
        attributes: [],
      },
    });

    expect(result.actionableCount).toBe(0);
    expect(result.recommendations[0]).toMatchObject({ status: "NEEDS_CONFIRMATION" });
  });
});
