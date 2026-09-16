export function parseTranslationArray(content: string, expectedLength: number): string[] {
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed) || parsed.length !== expectedLength) {
    throw new Error("模型翻译返回结果数量不匹配");
  }
  return parsed.map((item) => String(item));
}

export async function translateWithOpenAiCompatible(
  texts: string[],
  opts: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<string[]> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  const model = opts.model ?? process.env.OPENAI_AGENT_MODEL;
  if (!apiKey || !model || process.env.OPENAI_AGENT_MOCK !== "false") {
    throw new Error("模型翻译未配置：请设置 OPENAI_API_KEY、OPENAI_AGENT_MODEL、OPENAI_AGENT_MOCK=false");
  }

  const baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1")
    .replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "Translate Chinese ecommerce product listing text into natural Russian. Return only a JSON array of strings, same order and length.",
        },
        { role: "user", content: JSON.stringify(texts) },
      ],
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`模型翻译返回 ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型翻译未返回内容");
  return parseTranslationArray(content, texts.length);
}
