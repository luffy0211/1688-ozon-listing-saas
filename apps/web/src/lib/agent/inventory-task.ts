export type InventoryTarget = {
  mode: "set_total" | "add" | "ambiguous";
  value: number;
};

type ToolCallLike = {
  name: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function inventoryTaskContextFromToolCalls(toolCalls: ToolCallLike[]) {
  const call = [...toolCalls].reverse().find((item) =>
    ["diagnose_ozon_store", "get_ozon_store_snapshot"].includes(item.name) && !item.error,
  );
  if (!call) return null;
  const input = record(call.input);
  const output = record(call.output);
  const rawProducts = Array.isArray(output.lowStockProducts)
    ? output.lowStockProducts
    : Array.isArray(output.products)
      ? output.products
      : [];
  const selectedProducts = rawProducts.flatMap((value) => {
    const item = record(value);
    const offerId = typeof item.offerId === "string" ? item.offerId : null;
    if (!offerId) return [];
    return [{
      offerId,
      productId: typeof item.productId === "string" ? item.productId : null,
      stock: typeof item.stock === "number" ? item.stock : null,
    }];
  });
  return {
    version: 1 as const,
    storeId: typeof output.storeId === "string"
      ? output.storeId
      : typeof input.storeId === "string"
        ? input.storeId
        : null,
    selectedProducts,
  };
}

export function inventoryTaskContextForStore(taskContext: unknown, currentStoreId: string | null | undefined) {
  const context = record(taskContext);
  const contextStoreId = typeof context.storeId === "string" ? context.storeId : null;
  const requestedStoreId = typeof currentStoreId === "string" && currentStoreId.trim()
    ? currentStoreId.trim()
    : null;
  if (requestedStoreId && contextStoreId !== requestedStoreId) return null;
  return Object.keys(context).length ? context : null;
}

export function inventoryTaskContextForPrompt(taskContext: unknown, prompt: string) {
  const context = record(taskContext);
  const products = Array.isArray(context.selectedProducts) ? context.selectedProducts : [];
  const match = prompt.match(/第\s*([1-9]\d*|[一二三四五六七八九十])\s*(?:款|个|件|项)/);
  if (!match?.[1]) return Object.keys(context).length ? context : null;
  const chinese: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  const index = (chinese[match[1]] ?? Number(match[1])) - 1;
  const selected = products[index];
  return {
    ...context,
    selectedProducts: selected ? [selected] : [],
    ...(selected ? {} : { selectionError: "ordinal_out_of_range" }),
  };
}

export function nextInventoryTaskContext(
  previousContext: unknown,
  currentContext: unknown,
  prompt: string,
) {
  const previous = record(previousContext);
  const current = record(currentContext);
  if (!Object.keys(current).length) return Object.keys(previous).length ? previous : null;
  if (!Object.keys(previous).length || /(?:这款|该商品|这个商品|这三个|这几个|这些|每款|全部)/.test(prompt)) {
    return inventoryTaskContextForPrompt(current, prompt);
  }
  const previousProducts = Array.isArray(previous.selectedProducts) ? previous.selectedProducts.map(record) : [];
  const currentProducts = Array.isArray(current.selectedProducts) ? current.selectedProducts.map(record) : [];
  const selectedProducts = previousProducts.flatMap((selected) => {
    const match = currentProducts.find((product) =>
      (typeof selected.offerId === "string" && product.offerId === selected.offerId)
      || (typeof selected.productId === "string" && product.productId === selected.productId),
    );
    return match ? [match] : [];
  });
  return inventoryTaskContextForPrompt({ ...current, selectedProducts }, prompt);
}

export function inventoryWarehouseIdsFromToolCalls(toolCalls: ToolCallLike[]) {
  const call = [...toolCalls].reverse().find((item) => item.name === "list_ozon_warehouses");
  const warehouses = record(call?.output).warehouses;
  if (!Array.isArray(warehouses)) return [];
  return [...new Set(warehouses.flatMap((value) => {
    const item = record(value);
    const id = item.id ?? item.warehouse_id;
    return typeof id === "number" && Number.isInteger(id) && id > 0 ? [id] : [];
  }))];
}

type InventoryMutationActionLike = {
  type?: unknown;
  offerId?: unknown;
  productId?: unknown;
  payload?: unknown;
};

function stockItemsFromActions(actions: InventoryMutationActionLike[]) {
  return actions.flatMap((rawAction) => {
    const action = record(rawAction);
    const payload = record(action.payload);
    if (action.type === "UPDATE_STOCK") {
      return [{
        offerId: action.offerId ?? payload.offerId ?? payload.offer_id,
        productId: action.productId ?? payload.productId ?? payload.product_id,
        stock: payload.stock,
        warehouseId: payload.warehouseId ?? payload.warehouse_id,
      }];
    }
    if (action.type !== "BULK_PRODUCT_UPDATE" || !Array.isArray(payload.items)) return [];
    return payload.items.flatMap((value) => {
      const item = record(value);
      return item.type === "UPDATE_STOCK" ? [{
        offerId: item.offerId ?? item.offer_id,
        productId: item.productId ?? item.product_id,
        stock: item.stock,
        warehouseId: item.warehouseId ?? item.warehouse_id,
      }] : [];
    });
  });
}

export function validateInventoryMutationActions(params: {
  actions: InventoryMutationActionLike[];
  target: InventoryTarget | null;
  taskContext: unknown;
  warehouseIds: number[];
  explicitOfferId?: string | null;
  requireAllContextProducts?: boolean;
}) {
  const stockItems = stockItemsFromActions(params.actions);
  if (!stockItems.length) return;
  if (!params.target || params.target.mode === "ambiguous") {
    throw new Error("库存目标不明确：请先询问用户是增加库存还是补到目标总库存。");
  }
  if (params.target.mode === "add") {
    throw new Error("增加库存前必须读取目标仓库的当前库存，不能使用全店或跨仓总库存计算。");
  }
  if (stockItems.some((item) => item.stock !== params.target!.value)) {
    throw new Error("库存草案与用户确认的目标总库存不一致。");
  }

  const warehouseIds = new Set(params.warehouseIds);
  if (stockItems.some((item) => typeof item.warehouseId !== "number" || !warehouseIds.has(item.warehouseId))) {
    throw new Error("库存草案使用了未读取或不属于当前店铺的仓库。");
  }

  const contextProducts = Array.isArray(record(params.taskContext).selectedProducts)
    ? (record(params.taskContext).selectedProducts as unknown[]).map(record)
    : [];
  const contextProductForItem = (item: (typeof stockItems)[number]) => {
    const offerId = typeof item.offerId === "string" ? item.offerId : null;
    const productId = typeof item.productId === "string" || typeof item.productId === "number"
      ? String(item.productId)
      : null;
    if (!offerId && !productId) return null;
    return contextProducts.find((product) =>
      (!offerId || product.offerId === offerId)
      && (!productId || String(product.productId ?? "") === productId),
    ) ?? null;
  };
  const itemIsAllowed = (item: (typeof stockItems)[number]) => Boolean(contextProductForItem(item))
    || (item.offerId === params.explicitOfferId && item.productId == null);
  if (stockItems.some((item) => !itemIsAllowed(item))) {
    throw new Error("库存草案包含未确认的商品。");
  }
  const stockItemKeys = stockItems.map((item) => {
    const contextProduct = contextProductForItem(item);
    return typeof contextProduct?.offerId === "string"
      ? `offer:${contextProduct.offerId}`
      : typeof contextProduct?.productId === "string"
        ? `product:${contextProduct.productId}`
        : `offer:${String(item.offerId)}`;
  });
  if (new Set(stockItemKeys).size !== stockItemKeys.length) {
    throw new Error("库存草案包含重复商品。");
  }
  if (params.requireAllContextProducts && contextProducts.some((product) =>
    !stockItems.some((item) => contextProductForItem(item) === product),
  )) {
    throw new Error("库存草案没有覆盖用户确认的全部商品。");
  }
}

export function inventoryTargetFromPrompt(prompt: string): InventoryTarget | null {
  const setTotal = prompt.match(/(?:补到|调整到|改到|改为|改成|设为|设置为)\s*(\d+)\s*(?:件|个)?/);
  if (setTotal) return { mode: "set_total", value: Number(setTotal[1]) };

  const add = prompt.match(/(?:增加|加上?|追加)\s*(\d+)\s*(?:件|个)?/);
  if (add) return { mode: "add", value: Number(add[1]) };

  const ambiguous = prompt.match(/补\s*(\d+)\s*(?:件|个)?/);
  return ambiguous ? { mode: "ambiguous", value: Number(ambiguous[1]) } : null;
}
