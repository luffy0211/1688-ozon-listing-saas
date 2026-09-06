const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export type CompetitorSearchResult = {
  url: string;
  title: string;
  content: string;
  score: number;
};

export type OwnProductSearchInput = {
  title: string;
  sku?: string | null;
  offerId?: string | null;
  url?: string | null;
};

type TavilySearchClientOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

function normalizeOzonUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") return null;

  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.hostname.toLowerCase().replace(/^www\./, "") !== "ozon.ru") return null;

    url.protocol = "https:";
    url.hostname = "ozon.ru";
    url.port = "";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function containsIdentifier(url: string, identifier: string) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(url);
}

function parseResult(value: unknown): CompetitorSearchResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  const url = normalizeOzonUrl(result.url);
  if (
    !url ||
    typeof result.title !== "string" ||
    typeof result.content !== "string" ||
    typeof result.score !== "number" ||
    !Number.isFinite(result.score)
  ) {
    return null;
  }
  return { url, title: result.title.trim(), content: result.content.trim(), score: result.score };
}

export function createTavilyCompetitorSearchClient(options: TavilySearchClientOptions) {
  return {
    async search(product: OwnProductSearchInput): Promise<CompetitorSearchResult[]> {
      const apiKey = options.apiKey?.trim();
      if (!apiKey) throw new Error("Tavily search requires an API key");
      if (!product.title.trim()) throw new Error("Tavily search requires a product title");

      const response = await (options.fetchImpl ?? fetch)(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: product.title.trim(),
          search_depth: "basic",
          include_domains: ["ozon.ru"],
          max_results: 10,
        }),
      });
      if (!response.ok) throw new Error(`Tavily search failed: HTTP ${response.status}`);

      const payload = (await response.json()) as { results?: unknown };
      const ownUrl = normalizeOzonUrl(product.url);
      const ownIdentifiers = [product.sku, product.offerId]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value));
      const seen = new Set<string>();

      return (Array.isArray(payload.results) ? payload.results : [])
        .map(parseResult)
        .filter((result): result is CompetitorSearchResult => {
          if (!result || result.url === ownUrl || ownIdentifiers.some((id) => containsIdentifier(result.url, id))) {
            return false;
          }
          if (seen.has(result.url)) return false;
          seen.add(result.url);
          return true;
        })
        .slice(0, 5);
    },
  };
}
