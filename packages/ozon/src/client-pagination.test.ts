import { afterEach, describe, expect, it, vi } from "vitest";

import { OzonClient } from "./client";

describe("OzonClient product pagination", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads every product page using last_id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { items: [{ product_id: 1 }], total: 2, last_id: "next" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { items: [{ product_id: 2 }], total: 2, last_id: "" } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = new OzonClient({
      clientId: "123",
      apiKey: "key",
      baseUrl: "https://example.test",
    });

    await expect(client.listProducts(1)).resolves.toMatchObject({
      items: [{ product_id: 1 }, { product_id: 2 }],
      total: 2,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body))).toMatchObject({
      last_id: "next",
      limit: 1,
    });
  });

  it("stops with an explicit error when product pagination does not advance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { items: [{ product_id: 1 }], total: 2, last_id: "same" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new OzonClient({ clientId: "123", apiKey: "key", baseUrl: "https://example.test" });

    await expect(client.listProducts(1)).rejects.toThrow("product list pagination did not advance");
  });
});
