import { describe, expect, it } from "vitest";
import type { CategoryAttribute, CategoryNode } from "@saas/ozon";
import type { NormalizedProductFact } from "@saas/core";
import {
  buildRequiredOzonAttributes,
  matchOzonCategory,
  packageDefaults,
} from "./ozon-draft-facts";

const dressFact: NormalizedProductFact = {
  title: "2025夏季新无袖宽松长款连衣裙后背蝴蝶结女裙",
  categoryPath: ["1031910"],
  brand: { value: "无品牌", estimated: false, confidence: 1 },
  properties: [
    { name: "主面料成分", value: "涤纶", estimated: false, confidence: 1 },
    { name: "颜色", value: "黑色连衣裙", estimated: false, confidence: 1 },
  ],
  priceTiers: [{ minQuantity: 1, priceCny: 90 }],
  skus: [{ skuId: "1", name: "黑色连衣裙>L", attributes: { 颜色: "黑色连衣裙", 尺码: "L" } }],
  purchaseCny: { value: 90, estimated: true, confidence: 0.8 },
  mainImages: ["https://example.test/main.jpg"],
  detailImages: ["https://example.test/detail.jpg"],
};

describe("ozon draft facts", () => {
  it("matches dress products to a dress category/type from the Ozon tree", () => {
    const tree: CategoryNode[] = [
      {
        description_category_id: 10,
        category_name: "Одежда",
        children: [
          { type_id: 20, type_name: "Женские платья", children: [] },
        ],
      },
    ];

    expect(matchOzonCategory(tree, dressFact)).toMatchObject({
      descriptionCategoryId: 10,
      typeId: 20,
    });
  });

  it("matches wool outerwear products to a coat category/type", () => {
    const tree: CategoryNode[] = [
      {
        description_category_id: 10,
        category_name: "Одежда",
        children: [
          { type_id: 20, type_name: "Кардиган", children: [] },
          { type_id: 30, type_name: "Пальто", children: [] },
        ],
      },
    ];

    expect(matchOzonCategory(tree, {
      ...dressFact,
      title: "大图轮播",
      properties: [{ name: "主面料成分", value: "羊绒", estimated: false, confidence: 1 }],
    })).toMatchObject({
      descriptionCategoryId: 10,
      typeId: 30,
    });
  });

  it("uses clothing package defaults when dimensions are missing", () => {
    expect(packageDefaults(dressFact)).toEqual({
      weightGrams: 500,
      dimensions: { widthMm: 300, heightMm: 250, depthMm: 40 },
    });
  });

  it("builds required Ozon attributes without Chinese buyer-facing values", async () => {
    const attributes: CategoryAttribute[] = [
      { id: 85, name: "Бренд", description: "", type: "Dictionary", is_collection: false, is_required: true },
      { id: 10096, name: "Цвет", description: "", type: "Dictionary", is_collection: false, is_required: true },
      { id: 8229, name: "Материал", description: "", type: "String", is_collection: false, is_required: true },
      { id: 8292, name: "Объединить на одной карточке", description: "", type: "String", is_collection: false, is_required: true },
    ];

    const result = await buildRequiredOzonAttributes(
      dressFact,
      "Женское летнее платье без рукавов",
      attributes,
      [],
      async (attributeId) => {
        if (attributeId === 85) return [{ id: 1, value: "Нет бренда" }];
        if (attributeId === 10096) return [{ id: 2, value: "черный" }];
        return [];
      },
    );

    expect(result).toEqual([
      { id: 85, values: [{ value: "Нет бренда", dictionaryValueId: 1 }] },
      { id: 10096, values: [{ value: "черный", dictionaryValueId: 2 }] },
      { id: 8229, values: [{ value: "полиэстер" }] },
      { id: 8292, values: [{ value: "listing-1" }] },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/[\u3400-\u4dbf\u4e00-\u9fff]/);
  });

  it("adds safe generated live-listing attributes when the Ozon category supports them", async () => {
    const attributes: CategoryAttribute[] = [
      { id: 23171, name: "#Хештеги", description: "", type: "String", is_collection: false, is_required: false },
      { id: 4191, name: "Аннотация", description: "", type: "String", is_collection: false, is_required: false },
      { id: 11254, name: "Rich-контент JSON", description: "", type: "String", is_collection: false, is_required: false },
      { id: 9024, name: "Код продавца", description: "", type: "String", is_collection: false, is_required: false },
      { id: 9533, name: "Размер производителя", description: "", type: "String", is_collection: false, is_required: false },
      { id: 4389, name: "Страна-изготовитель", description: "", type: "Dictionary", is_collection: false, is_required: false },
      { id: 8789, name: "Название файла PDF", description: "", type: "String", is_collection: false, is_required: false },
      { id: 21837, name: "Озон.Видео: название", description: "", type: "String", is_collection: false, is_required: false },
    ];

    const result = await buildRequiredOzonAttributes(
      dressFact,
      "Женское летнее платье без рукавов",
      attributes,
      [],
      async (attributeId) => attributeId === 4389 ? [{ id: 1, value: "Россия" }] : [],
      {
        descriptionRu: "Легкое платье для летнего образа.",
        bulletPointsRu: ["Свободный крой"],
        searchKeywordsRu: "#платье #летнееплатье",
        detailImages: ["https://example.test/detail.jpg"],
      },
    );

    expect(result).toEqual([
      { id: 23171, values: [{ value: "#платье #летнееплатье" }] },
      { id: 4191, values: [{ value: "Легкое платье для летнего образа.<br/><br/>Свободный крой" }] },
      { id: 11254, values: [{ value: expect.stringContaining("https://example.test/detail.jpg") }] },
      { id: 9024, values: [{ value: "1" }] },
      { id: 9533, values: [{ value: "L" }] },
    ]);
  });

  it("does not use arbitrary dictionary fallback values", async () => {
    const result = await buildRequiredOzonAttributes(
      dressFact,
      "Женское летнее платье без рукавов",
      [{ id: 23171, name: "#Хештеги", description: "", type: "Dictionary", is_collection: false, is_required: false }],
      [],
      async () => [{ id: 1, value: "Нет бренда" }],
      { searchKeywordsRu: "#платье #летнееплатье" },
    );

    expect(result).toEqual([]);
  });

  it("uses the primary attribute name before long Ozon descriptions", async () => {
    const result = await buildRequiredOzonAttributes(
      dressFact,
      "Женское летнее платье без рукавов",
      [
        {
          id: 9024,
          name: "Код продавца",
          description: "Пол, бренд и другие поисковые характеристики",
          type: "String",
          is_collection: false,
          is_required: false,
        },
      ],
      [],
      async () => [],
    );

    expect(result).toEqual([{ id: 9024, values: [{ value: "1" }] }]);
  });
});
