import { afterEach, describe, expect, it, vi } from "vitest";

import { OzonClient } from "./client";

describe("Ozon warehouses", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads warehouse names and ids without enabling real submit", async () => {
    const warehouses = [{ warehouse_id: 10, name: "Main FBS", is_rfbs: false }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: warehouses }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new OzonClient({
      clientId: "123",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: false,
    });

    await expect(client.listWarehouses()).resolves.toEqual(warehouses);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/warehouse/list",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
