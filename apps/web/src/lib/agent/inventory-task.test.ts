import { describe, expect, it } from "vitest";

import { inventoryTaskContextFromToolCalls, inventoryTargetFromPrompt } from "./inventory-task";

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
});
