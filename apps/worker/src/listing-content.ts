import type { NormalizedProductFact } from "@saas/core";

export type RussianListingContent = {
  titleRu: string;
  descriptionRu: string;
  bulletPointsRu: string[];
  hashtagsRu: string;
};

function parseJsonObject(content: string): Record<string, unknown> {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("模型商品文案返回结果不是 JSON object");
  }
  return parsed as Record<string, unknown>;
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value.trim() : "";
}

function stringArrayField(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
    : [];
}

export function parseRussianListingContent(content: string): RussianListingContent {
  const data = parseJsonObject(content);
  const result = {
    titleRu: stringField(data, "titleRu"),
    descriptionRu: stringField(data, "descriptionRu"),
    bulletPointsRu: stringArrayField(data, "bulletPointsRu"),
    hashtagsRu: stringField(data, "hashtagsRu"),
  };
  if (!result.titleRu || !result.descriptionRu || result.bulletPointsRu.length === 0) {
    throw new Error("模型商品文案缺少 titleRu/descriptionRu/bulletPointsRu");
  }
  return result;
}

export async function generateRussianListingContent(
  fact: NormalizedProductFact,
  opts: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<RussianListingContent> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  const model = opts.model ?? process.env.OPENAI_AGENT_MODEL;
  if (!apiKey || !model || process.env.OPENAI_AGENT_MOCK !== "false") {
    throw new Error("模型商品文案未配置：请设置 OPENAI_API_KEY、OPENAI_AGENT_MODEL、OPENAI_AGENT_MOCK=false");
  }

  const baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const res = await (opts.fetchImpl ?? fetch)(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "You write Russian Ozon fashion listings from Chinese 1688 product facts.",
            "Return only JSON with keys: titleRu, descriptionRu, bulletPointsRu, hashtagsRu.",
            "No Chinese buyer-facing text. Do not invent brand, certification, or material not present in facts.",
            "Use natural ecommerce Russian, concise title, 4-6 selling bullets, and hashtag string.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            title: fact.title,
            categoryPath: fact.categoryPath,
            brand: fact.brand.value,
            properties: fact.properties.map((item) => ({ name: item.name, value: item.value })),
            skus: fact.skus.slice(0, 20).map((sku) => ({ name: sku.name, attributes: sku.attributes })),
            descriptionText: fact.descriptionText,
          }),
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`模型商品文案返回 ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型商品文案未返回内容");
  return parseRussianListingContent(content);
}
