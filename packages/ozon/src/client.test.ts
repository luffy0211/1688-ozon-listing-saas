import { afterEach, describe, expect, it, vi } from "vitest";
import { OzonClient } from "./client";

describe("OzonClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows read-only requests when real submit is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { items: [{ product_id: 1, offer_id: "offer-1" }], total: 1 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new OzonClient({
      clientId: "123456",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: false,
    });

    await expect(client.listProducts()).resolves.toEqual({
      items: [{ product_id: 1, offer_id: "offer-1" }],
      total: 1,
      last_id: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v3/product/list",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reads FBS postings from the v4 response shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ postings: [{ posting_number: "fbs-1" }], has_next: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new OzonClient({
      clientId: "123456",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: false,
    });

    await expect(
      client.listFbsPostings({
        since: new Date("2026-09-01T00:00:00.000Z"),
        to: new Date("2026-09-03T00:00:00.000Z"),
      }),
    ).resolves.toEqual([{ posting_number: "fbs-1" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v4/posting/fbs/list",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("clamps FBS posting limit to the Ozon v4 maximum", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ postings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new OzonClient({
      clientId: "123456",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: false,
    });

    await client.listFbsPostings({
      since: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-03T00:00:00.000Z"),
      limit: 1000,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.limit).toBe(100);
  });

  it("rejects submit requests when real submit is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new OzonClient({
      clientId: "123456",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: false,
    });

    await expect(client.importProducts({
      items: [
        {
          offer_id: "offer-1",
          name: "Product",
          description: "Description",
          description_category_id: 1,
          type_id: 2,
          price: "100",
          old_price: "120",
          vat: "0",
          currency_code: "RUB",
          images: ["https://example.test/image.jpg"],
          attributes: [],
          weight: 100,
          width: 100,
          height: 100,
          depth: 100,
          dimension_unit: "mm",
          weight_unit: "g",
        },
      ],
    })).rejects.toThrow("ENABLE_REAL_OZON_SUBMIT=false");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls price import only when real submit is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { task_id: 321 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new OzonClient({
      clientId: "123456",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: true,
    });

    await expect(
      client.importPrices({
        prices: [
          {
            offer_id: "offer-1",
            price: "100",
            old_price: "0",
            currency_code: "RUB",
          },
        ],
      }),
    ).resolves.toMatchObject({ task_id: 321 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/product/import/prices",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("calls archive endpoints only when real submit is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new OzonClient({
      clientId: "123456",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: true,
    });

    await client.archiveProducts({ product_id: [99] });
    await client.unarchiveProducts({ product_id: [99] });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://example.test/v1/product/archive",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.test/v1/product/unarchive",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("calls product mutation endpoints only when real submit is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [{ updated: true }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new OzonClient({
      clientId: "123456",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: true,
    });

    await client.updateStocks({
      stocks: [{ offer_id: "offer-1", stock: 3, warehouse_id: 10 }],
    });
    await client.importPictures({
      product_id: 99,
      images: ["https://example.test/image.jpg"],
    });
    await client.updateAttributes({
      items: [{ offer_id: "offer-1", attributes: [{ id: 1, values: [{ value: "Red" }] }] }],
    });
    await client.deleteProducts({
      products: [{ product_id: 99 }],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://example.test/v2/products/stocks",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.test/v1/product/pictures/import",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://example.test/v1/product/attributes/update",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://example.test/v2/products/delete",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects stock updates when real submit is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new OzonClient({
      clientId: "123456",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: false,
    });

    await expect(
      client.updateStocks({
        stocks: [{ offer_id: "offer-1", stock: 3, warehouse_id: 10 }],
      }),
    ).rejects.toThrow("ENABLE_REAL_OZON_SUBMIT=false");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid Client-Id before calling Ozon", () => {
    expect(
      () =>
        new OzonClient({
          clientId: "client",
          apiKey: "key",
          baseUrl: "https://example.test",
        }),
    ).toThrow("Ozon Client ID must be a positive integer");
  });

  it("passes type_id when reading category attributes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new OzonClient({
      clientId: "123456",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: false,
    });

    await client.getCategoryAttributes(17027904, 93337);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body).toMatchObject({
      description_category_id: 17027904,
      type_id: 93337,
      language: "RU",
    });
  });

  it("paginates category attribute values with type_id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ id: 10, value: "A" }], has_next: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ id: 20, value: "B" }], has_next: false }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = new OzonClient({
      clientId: "123456",
      apiKey: "key",
      baseUrl: "https://example.test",
      enableRealSubmit: false,
    });

    await expect(client.getAttributeValues(17027904, 93337, 85)).resolves.toEqual([
      { id: 10, value: "A" },
      { id: 20, value: "B" },
    ]);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]![1].body));
    expect(firstBody).toMatchObject({ type_id: 93337, limit: 5000, last_value_id: 0 });
    expect(secondBody).toMatchObject({ type_id: 93337, limit: 5000, last_value_id: 10 });
  });
});
