import { describe, expect, it } from "vitest";

import {
  inventoryTaskContextForStore,
  inventoryTaskContextFromToolCalls,
  inventoryTaskContextForPrompt,
  inventoryWarehouseIdsFromToolCalls,
  inventoryTargetFromPrompt,
  nextInventoryTaskContext,
  validateInventoryMutationActions,
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

  it("keeps the selected product through an explanatory turn", () => {
    const selected = {
      version: 1,
      storeId: "store-1",
      selectedProducts: [{ offerId: "B", productId: "2", stock: 3 }],
    };
    expect(nextInventoryTaskContext(selected, null, "解释一下补到和增加的区别")).toEqual(selected);
    expect(nextInventoryTaskContext(selected, {
      version: 1,
      storeId: "store-1",
      selectedProducts: [{ offerId: "A", productId: "1", stock: 0 }],
    }, "这款补到20")).toEqual({
      version: 1,
      storeId: "store-1",
      selectedProducts: [{ offerId: "A", productId: "1", stock: 0 }],
    });
  });

  it("replaces an old selection with the current inventory snapshot", () => {
    const previous = {
      version: 1,
      storeId: "store-1",
      selectedProducts: [{ offerId: "A", productId: "1", stock: 0 }],
    };
    const current = inventoryTaskContextFromToolCalls([{
      name: "get_ozon_store_snapshot",
      input: { storeId: "store-1" },
      output: { products: [{ offerId: "D", productId: "4", stock: 2 }] },
    }]);
    expect(nextInventoryTaskContext(previous, current, "这三个每款补到20")).toEqual(current);
  });

  it("keeps a selected product while refreshing its current inventory data", () => {
    const previous = {
      version: 1,
      storeId: "store-1",
      selectedProducts: [{ offerId: "B", productId: "2", stock: 3 }],
    };
    const current = {
      version: 1,
      storeId: "store-1",
      selectedProducts: [
        { offerId: "A", productId: "1", stock: 0 },
        { offerId: "B", productId: "2", stock: 4 },
        { offerId: "C", productId: "3", stock: 5 },
      ],
    };
    expect(nextInventoryTaskContext(previous, current, "补到20")).toEqual({
      ...current,
      selectedProducts: [{ offerId: "B", productId: "2", stock: 4 }],
    });
  });

  it("reads only warehouse ids returned by the warehouse tool", () => {
    expect(inventoryWarehouseIdsFromToolCalls([{
      name: "list_ozon_warehouses",
      output: { warehouses: [{ id: 10 }, { warehouse_id: 20 }, { id: "fake" }] },
    }])).toEqual([10, 20]);
  });
});

describe("inventory mutation guard", () => {
  const taskContext = {
    version: 1,
    storeId: "store-1",
    selectedProducts: [
      { offerId: "A", productId: "1", stock: 0 },
      { offerId: "B", productId: "2", stock: 3 },
    ],
  };

  it("accepts direct and bulk stock targets inside the confirmed scope", () => {
    expect(() => validateInventoryMutationActions({
      actions: [{ type: "UPDATE_STOCK", offerId: "A", payload: { stock: 20, warehouseId: 10 } }],
      target: { mode: "set_total", value: 20 },
      taskContext,
      warehouseIds: [10],
    })).not.toThrow();
    expect(() => validateInventoryMutationActions({
      actions: [{
        type: "BULK_PRODUCT_UPDATE",
        payload: { items: [
          { type: "UPDATE_STOCK", offerId: "A", stock: 20, warehouseId: 10 },
          { type: "UPDATE_STOCK", offerId: "B", stock: 20, warehouseId: 10 },
        ] },
      }],
      target: { mode: "set_total", value: 20 },
      taskContext,
      warehouseIds: [10],
    })).not.toThrow();
  });

  it("rejects bulk stock values, warehouses, and products outside the approved scope", () => {
    const proposal = (item: Record<string, unknown>) => [{
      type: "BULK_PRODUCT_UPDATE",
      payload: { items: [{ type: "UPDATE_STOCK", offerId: "A", stock: 20, warehouseId: 10, ...item }] },
    }];
    expect(() => validateInventoryMutationActions({
      actions: proposal({ stock: 21 }),
      target: { mode: "set_total", value: 20 },
      taskContext,
      warehouseIds: [10],
    })).toThrow("库存草案与用户确认的目标总库存不一致");
    expect(() => validateInventoryMutationActions({
      actions: proposal({ warehouseId: 999 }),
      target: { mode: "set_total", value: 20 },
      taskContext,
      warehouseIds: [10],
    })).toThrow("库存草案使用了未读取或不属于当前店铺的仓库");
    expect(() => validateInventoryMutationActions({
      actions: proposal({ offerId: "C" }),
      target: { mode: "set_total", value: 20 },
      taskContext,
      warehouseIds: [10],
    })).toThrow("库存草案包含未确认的商品");
    expect(() => validateInventoryMutationActions({
      actions: proposal({ offerId: "A", productId: "999" }),
      target: { mode: "set_total", value: 20 },
      taskContext,
      warehouseIds: [10],
    })).toThrow("库存草案包含未确认的商品");
  });

  it("accepts snake-case identifiers returned by the model", () => {
    expect(() => validateInventoryMutationActions({
      actions: [{
        type: "BULK_PRODUCT_UPDATE",
        payload: { items: [{
          type: "UPDATE_STOCK",
          offer_id: "A",
          product_id: "1",
          stock: 20,
          warehouse_id: 10,
        }] },
      }],
      target: { mode: "set_total", value: 20 },
      taskContext,
      warehouseIds: [10],
    })).not.toThrow();
  });

  it("requires every confirmed product exactly once for collective requests", () => {
    const bulk = (items: Array<Record<string, unknown>>) => [{
      type: "BULK_PRODUCT_UPDATE",
      payload: { items: items.map((item) => ({
        type: "UPDATE_STOCK",
        stock: 20,
        warehouseId: 10,
        ...item,
      })) },
    }];
    expect(() => validateInventoryMutationActions({
      actions: bulk([{ offerId: "A" }]),
      target: { mode: "set_total", value: 20 },
      taskContext,
      warehouseIds: [10],
      requireAllContextProducts: true,
    })).toThrow("库存草案没有覆盖用户确认的全部商品");
    expect(() => validateInventoryMutationActions({
      actions: bulk([{ offerId: "A" }, { offerId: "A" }, { offerId: "B" }]),
      target: { mode: "set_total", value: 20 },
      taskContext,
      warehouseIds: [10],
      requireAllContextProducts: true,
    })).toThrow("库存草案包含重复商品");
  });

  it("does not turn an ambiguous or warehouse-aggregate increment into an executable draft", () => {
    const actions = [{ type: "UPDATE_STOCK", offerId: "A", payload: { stock: 20, warehouseId: 10 } }];
    expect(() => validateInventoryMutationActions({
      actions,
      target: { mode: "ambiguous", value: 20 },
      taskContext,
      warehouseIds: [10],
    })).toThrow("库存目标不明确");
    expect(() => validateInventoryMutationActions({
      actions,
      target: { mode: "add", value: 20 },
      taskContext,
      warehouseIds: [10],
    })).toThrow("增加库存前必须读取目标仓库的当前库存");
  });
});
