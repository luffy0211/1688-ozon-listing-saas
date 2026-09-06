import { describe, expect, it, vi } from "vitest";
import type { CategoryNode } from "@saas/ozon";
import {
  chooseOzonCategoryWithModel,
  matchOzonCategoryWithModel,
  parseCategoryChoice,
  type CategoryChoiceInput,
} from "./ozon-category-match";

const tree: CategoryNode[] = [
  {
    category_name: "Одежда",
    children: [
      {
        description_category_id: 17027904,
        category_name: "Одежда",
        children: [
          { type_id: 93337, type_name: "Футболка" },
          { type_id: 971234, type_name: "Платье" },
        ],
      },
    ],
  },
  {
    category_name: "Электроника",
    children: [
      {
        description_category_id: 17028647,
        category_name: "Аксессуары",
        children: [
          { type_id: 971066314, type_name: "Кабель" },
          { type_id: 971066315, type_name: "Наушники" },
        ],
      },
    ],
  },
];

function semanticChooser(input: CategoryChoiceInput) {
  const wanted = /футбол/i.test(input.product.titleRu)
    ? ["Одежда", "Одежда", "Футболка"]
    : ["Электроника", "Аксессуары", "Кабель"];
  const title = wanted[input.path.length];
  return Promise.resolve({
    candidateIndex: input.candidates.find((candidate) => candidate.title === title)!.index,
    confidence: 0.95,
  });
}

describe("model-backed Ozon category matching", () => {
  it("matches the failed short-sleeve product through the full Ozon tree", async () => {
    const choose = vi.fn(semanticChooser);

    await expect(matchOzonCategoryWithModel(tree, {
      titleZh: "230g纯棉白色短袖t恤女2026新款宽松厚实不透纯色男女款品质t大码",
      titleRu: "Женская белая хлопковая футболка свободного кроя",
      categoryPath: [],
      properties: [{ name: "面料", value: "纯棉" }],
    }, choose)).resolves.toEqual({
      descriptionCategoryId: 17027904,
      typeId: 93337,
      title: "Одежда / Одежда / Футболка",
    });
    expect(choose).toHaveBeenCalledTimes(3);
  });

  it("uses the same matcher for a non-clothing product", async () => {
    await expect(matchOzonCategoryWithModel(tree, {
      titleZh: "USB-C快充数据线",
      titleRu: "Кабель USB-C для быстрой зарядки",
      categoryPath: ["数码配件"],
      properties: [],
    }, semanticChooser)).resolves.toMatchObject({
      descriptionCategoryId: 17028647,
      typeId: 971066314,
    });
  });

  it("rejects low-confidence model choices", async () => {
    await expect(matchOzonCategoryWithModel(tree, {
      titleZh: "不明确商品",
      titleRu: "Неизвестный товар",
      categoryPath: [],
      properties: [],
    }, async () => ({ candidateIndex: 0, confidence: 0.4 })))
      .rejects.toThrow("置信度过低");
  });

  it("does not offer sensitive fashion types for a normal product", async () => {
    const choose = vi.fn(async (input: CategoryChoiceInput) => {
      if (input.path.length === 0) return { candidateIndex: 0, confidence: 0.95 };
      expect(input.candidates.map((candidate) => candidate.title)).toEqual(["Футболка"]);
      return { candidateIndex: 0, confidence: 0.95 };
    });

    await expect(matchOzonCategoryWithModel([{
      description_category_id: 17027904,
      category_name: "Одежда",
      children: [
        { type_id: 1, type_name: "Эротическая футболка" },
        { type_id: 2, type_name: "Футболка" },
      ],
    }], {
      titleZh: "女士短袖T恤",
      titleRu: "Женская футболка",
      categoryPath: ["女装"],
      properties: [],
    }, choose)).resolves.toMatchObject({ typeId: 2 });
  });

  it("parses strict JSON choices without accepting an invented id", () => {
    expect(parseCategoryChoice("```json\n{\"candidateIndex\":1,\"confidence\":0.9}\n```", 2))
      .toEqual({ candidateIndex: 1, confidence: 0.9 });
    expect(() => parseCategoryChoice('{"candidateIndex":3,"confidence":0.9}', 2))
      .toThrow("候选序号无效");
    expect(() => parseCategoryChoice('{"candidateIndex":"1","confidence":0.9}', 2))
      .toThrow("候选序号无效");
  });

  it("sends candidate labels to the model and parses its selected index", async () => {
    vi.stubEnv("OPENAI_AGENT_MOCK", "false");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"candidateIndex":1,"confidence":0.92}' } }],
    }), { status: 200 }));

    try {
      await expect(chooseOzonCategoryWithModel({
        product: {
          titleZh: "USB-C快充数据线",
          titleRu: "Кабель USB-C для быстрой зарядки",
          categoryPath: ["数码配件"],
          properties: [],
        },
        path: ["Электроника"],
        candidates: [
          { index: 0, title: "Наушники", terminal: true },
          { index: 1, title: "Кабель", terminal: true },
        ],
      }, {
        apiKey: "test-key",
        baseUrl: "https://model.test",
        model: "test-model",
        fetchImpl,
      })).resolves.toEqual({ candidateIndex: 1, confidence: 0.92 });
      const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
      expect(request.messages[1].content).toContain("Кабель");
      expect(request.messages[1].content).not.toContain("typeId");
      expect(fetchImpl.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
