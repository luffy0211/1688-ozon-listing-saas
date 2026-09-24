import { describe, expect, it } from "vitest";

import {
  inventoryTaskContextForStore,
  inventoryTaskContextFromToolCalls,
  inventoryTaskContextForPrompt,
  inventoryTargetFromPrompt,
} from "./inventory-task";

describe("inventory task target", () => {
  it("treats 补到20 as an absolute target", () => {
    expect(inventoryTargetFromPrompt("这三个每款补到20")).toEqual({
      mode: "set_total",
      value: 20,
    });
  });

  it("requires clarification for ambiguous 补20", () => {
    expect(inventoryTargetFromPrompt("这三个每款补20")).toEqual({
      mode: "ambiguous",
      value: 20,
    });
  });

  it("treats 增加20 as an increment", () => {
    expect(inventoryTargetFromPrompt("这三个每款增加20件")).toEqual({
      mode: "add",
      value: 20,
    });
  });
});

describe("inventory task context", () => {
  it("persists the affected product set from the previous diagnosis", () => {
    expect(inventoryTaskContextFromToolCalls([{
      name: "diagnose_ozon_store",
      input: { storeId: "store-1" },
      output: {
        lowStockProducts: [
          { offerId: "A", productId: "1", stock: 0 },
          { offerId: "B", productId: "2", stock: 3 },
          { offerId: "C", productId: "3", stock: 5 },
        ],
      },
    }])).toEqual({
      version: 1,
      storeId: "store-1",
      selectedProducts: [
        { offerId: "A", productId: "1", stock: 0 },
        { offerId: "B", productId: "2", stock: 3 },
        { offerId: "C", productId: "3", stock: 5 },
      ],
    });
  });

  it("does not reuse a previous product set after switching stores", () => {
    const context = {
      version: 1,
      storeId: "store-1",
      selectedProducts: [{ offerId: "A", productId: "1", stock: 0 }],
    };

    expect(inventoryTaskContextForStore(context, "store-2")).toBeNull();
    expect(inventoryTaskContextForStore(context, "store-1")).toEqual(context);
  });

  it("does not reuse products with unknown store ownership in an explicit store", () => {
    expect(inventoryTaskContextForStore({
      version: 1,
      storeId: null,
      selectedProducts: [{ offerId: "A", productId: "1", stock: 0 }],
    }, "store-2")).toBeNull();
  });

  it("narrows an existing product set when the user selects the second item", () => {
    const context = {
      version: 1,
      storeId: "store-1",
      selectedProducts: [
        { offerId: "A", productId: "1", stock: 0 },
        { offerId: "B", productId: "2", stock: 3 },
        { offerId: "C", productId: "3", stock: 5 },
      ],
    };

    expect(inventoryTaskContextForPrompt(context, "只处理第二款")).toEqual({
      ...context,
      selectedProducts: [{ offerId: "B", productId: "2", stock: 3 }],
    });
  });
});
