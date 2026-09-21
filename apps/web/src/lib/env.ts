import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const envPath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (!existsSync(/* turbopackIgnore: true */ envPath)) continue;
  for (const line of readFileSync(/* turbopackIgnore: true */ envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    const key = match?.[1];
    const value = match?.[2];
    if (!key || value === undefined || process.env[key]) continue;
    process.env[key] = value.replace(/^['"]|['"]$/g, "");
  }
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  sessionSecret:
    process.env.SESSION_SECRET ?? "dev-insecure-session-secret-change-me",
  encryptionKey: process.env.APP_ENCRYPTION_KEY ?? "dev-insecure-encryption-key-change-me",
  ozonApiBase: process.env.OZON_API_BASE ?? "https://api-seller.ozon.ru",
  enableRealOzonSubmit: process.env.ENABLE_REAL_OZON_SUBMIT === "true",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "",
  openaiAgentModel: process.env.OPENAI_AGENT_MODEL ?? "",
  openaiAgentMock: process.env.OPENAI_AGENT_MOCK !== "false",
  openaiAgentTraceSensitiveData:
    process.env.OPENAI_AGENT_TRACE_SENSITIVE_DATA === "true",
  visionEnabled: process.env.VISION_ENABLED === "true",
  visionApiKey: process.env.VISION_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  visionBaseUrl: process.env.VISION_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "",
  visionModel: process.env.VISION_MODEL ?? "deepseek-flash",
  agentMinMarginRate: Number(process.env.AGENT_MIN_MARGIN_RATE ?? "0.25"),
  agentMinProfitRub: Number(process.env.AGENT_MIN_PROFIT_RUB ?? "100"),
  agentCompetitorCacheHours: Number(
    process.env.AGENT_COMPETITOR_CACHE_HOURS ?? "24",
  ),
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  ozonCrawlerPython: process.env.OZON_CRAWLER_PYTHON ?? "python",
  ozonCrawlerScript: process.env.OZON_CRAWLER_SCRIPT ?? "",
  ozonCrawlerCookieJar: process.env.OZON_CRAWLER_COOKIE_JAR ?? "",
  ozonCrawlerCookieTsv: process.env.OZON_CRAWLER_COOKIE_TSV ?? "",
  ozonCrawlerProxy: process.env.OZON_CRAWLER_PROXY ?? "socks5h://127.0.0.1:10808",
  ozonCrawlerScanPages: Math.max(1, Number(process.env.OZON_CRAWLER_SCAN_PAGES ?? "5") || 5),
  ozonCrawlerTimeoutMs: Math.max(30_000, Number(process.env.OZON_CRAWLER_TIMEOUT_MS ?? "900000") || 900_000),
  xiangjiApiBase: process.env.XIANGJI_API_BASE ?? "https://api.tosoiot.com",
  xiangjiMock: process.env.XIANGJI_MOCK === "true",
};
