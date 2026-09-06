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
  agentMinMarginRate: Number(process.env.AGENT_MIN_MARGIN_RATE ?? "0.25"),
  agentMinProfitRub: Number(process.env.AGENT_MIN_PROFIT_RUB ?? "100"),
  agentCompetitorCacheHours: Number(
    process.env.AGENT_COMPETITOR_CACHE_HOURS ?? "24",
  ),
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  xiangjiApiBase: process.env.XIANGJI_API_BASE ?? "https://api.tosoiot.com",
  xiangjiMock: process.env.XIANGJI_MOCK === "true",
};
