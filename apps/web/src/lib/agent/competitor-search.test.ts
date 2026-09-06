import { describe, expect, it, vi } from "vitest";
import { createTavilyCompetitorSearchClient } from "./competitor-search";

const result = (url: string, score = 0.9) => ({
  url,
  title: `Title ${score}`,
  content: `Content ${score}`,
  score,
});

describe("Tavily competitor search", () => {
  it("searches only ozon.ru with basic search", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            result("https://www.ozon.ru/product/item-101/?from=search#top"),
            result("https://example.com/product/not-ozon"),
          ],
        }),
      ),
    );
    const client = createTavilyCompetitorSearchClient({ apiKey: "test-key", fetchImpl });

    await expect(client.search({ title: "Own product" })).resolves.toEqual([
      {
        ...result("https://www.ozon.ru/product/item-101/?from=search#top"),
        url: "https://ozon.ru/product/item-101",
      },
    ]);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({ method: "POST" }),
    );
    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(request).toMatchObject({
      api_key: "test-key",
      query: "Own product",
      search_depth: "basic",
      include_domains: ["ozon.ru"],
    });
  });

  it("deduplicates normalized URLs and excludes the own product", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            result("https://www.ozon.ru/product/own-123456789/?x=1"),
            result("https://ozon.ru/product/by-offer/OWN-OFFER"),
            result("https://ozon.ru/product/by-url-777/"),
            result("https://www.ozon.ru/product/other-888/?a=1", 0.8),
            result("https://ozon.ru/product/other-888", 0.7),
          ],
        }),
      ),
    );
    const client = createTavilyCompetitorSearchClient({ apiKey: "test-key", fetchImpl });

    const results = await client.search({
      title: "Own product",
      sku: "123456789",
      offerId: "OWN-OFFER",
      url: "https://www.ozon.ru/product/by-url-777/?tracking=1",
    });

    expect(results).toEqual([
      { ...result("https://www.ozon.ru/product/other-888/?a=1", 0.8), url: "https://ozon.ru/product/other-888" },
    ]);
  });

  it("returns at most five results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: Array.from({ length: 7 }, (_, index) =>
            result(`https://ozon.ru/product/item-${index + 1}`, 1 - index / 10),
          ),
        }),
      ),
    );
    const client = createTavilyCompetitorSearchClient({ apiKey: "test-key", fetchImpl });

    await expect(client.search({ title: "Own product" })).resolves.toHaveLength(5);
  });

  it("requires an API key without making a request", async () => {
    const fetchImpl = vi.fn();
    const client = createTavilyCompetitorSearchClient({ apiKey: " ", fetchImpl });

    await expect(client.search({ title: "Own product" })).rejects.toThrow(
      "Tavily search requires an API key",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports HTTP errors without exposing the API key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("upstream failure", { status: 503 }));
    const client = createTavilyCompetitorSearchClient({ apiKey: "secret-key", fetchImpl });

    const error = await client.search({ title: "Own product" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Tavily search failed: HTTP 503");
    expect((error as Error).message).not.toContain("secret-key");
  });
});
