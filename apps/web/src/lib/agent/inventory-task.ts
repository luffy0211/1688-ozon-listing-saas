export type InventoryTarget = {
  mode: "set_total" | "add" | "ambiguous";
  value: number;
};

type ToolCallLike = {
  name: string;
  input?: unknown;
  output?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function inventoryTaskContextFromToolCalls(toolCalls: ToolCallLike[]) {
  const call = [...toolCalls].reverse().find((item) =>
    ["diagnose_ozon_store", "get_ozon_store_snapshot"].includes(item.name),
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

export function inventoryTargetFromPrompt(prompt: string): InventoryTarget | null {
  const setTotal = prompt.match(/(?:补到|调整到|改到|改为|设为|设置为)\s*(\d+)\s*(?:件|个)?/);
  if (setTotal) return { mode: "set_total", value: Number(setTotal[1]) };

  const add = prompt.match(/(?:增加|加上?|追加)\s*(\d+)\s*(?:件|个)?/);
  if (add) return { mode: "add", value: Number(add[1]) };

  const ambiguous = prompt.match(/补\s*(\d+)\s*(?:件|个)?/);
  return ambiguous ? { mode: "ambiguous", value: Number(ambiguous[1]) } : null;
}
