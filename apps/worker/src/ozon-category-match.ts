import type { CategoryNode } from "@saas/ozon";

export type CategoryProduct = {
  titleZh: string;
  titleRu: string;
  categoryPath: string[];
  properties: Array<{ name: string; value: string }>;
};

export type CategoryChoiceInput = {
  product: CategoryProduct;
  path: string[];
  candidates: Array<{ index: number; title: string; terminal: boolean }>;
};

type CategoryChoice = {
  candidateIndex: number;
  confidence: number;
};

type ChooseCategory = (input: CategoryChoiceInput) => Promise<CategoryChoice>;

const MIN_CATEGORY_CONFIDENCE = 0.7;
const MODEL_TIMEOUT_MS = 30_000;

function nodeTitle(node: CategoryNode): string {
  return String(node.type_name ?? node.category_name ?? node.title ?? node.name ?? "").trim();
}

function positiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function isSensitiveCategory(path: string): boolean {
  return /эротичес|сексуальн|гоу-гоу|go-go|adult/i.test(path);
}

export function parseCategoryChoice(content: string, candidateCount: number): CategoryChoice {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const candidateIndex = parsed.candidateIndex;
  const confidence = parsed.confidence;
  if (
    typeof candidateIndex !== "number" ||
    !Number.isInteger(candidateIndex) ||
    candidateIndex < 0 ||
    candidateIndex >= candidateCount
  ) {
    throw new Error("DeepSeek 返回的 Ozon 类目候选序号无效");
  }
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("DeepSeek 返回的 Ozon 类目置信度无效");
  }
  return { candidateIndex, confidence };
}

export async function chooseOzonCategoryWithModel(
  input: CategoryChoiceInput,
  opts: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<CategoryChoice> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  const model = opts.model ?? process.env.OPENAI_AGENT_MODEL;
  if (!apiKey || !model || process.env.OPENAI_AGENT_MOCK !== "false") {
    throw new Error("Ozon 类目匹配模型未配置");
  }
  const baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1")
    .replace(/\/+$/, "");
  const response = await (opts.fetchImpl ?? fetch)(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
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
          content: [
            "Classify an ecommerce product into exactly one candidate from the current Ozon category level.",
            "Use the product's actual type and purpose, not marketing words, color, gender, or material alone.",
            "Return only JSON: {\"candidateIndex\": number, \"confidence\": number}.",
            "candidateIndex must be copied from the candidates. Never invent or return category IDs.",
          ].join(" "),
        },
        { role: "user", content: JSON.stringify(input) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Ozon 类目匹配模型返回 ${response.status}: ${body.slice(0, 300)}`);
  const json = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Ozon 类目匹配模型未返回内容");
  return parseCategoryChoice(content, input.candidates.length);
}

export async function matchOzonCategoryWithModel(
  tree: CategoryNode[],
  product: CategoryProduct,
  choose: ChooseCategory = chooseOzonCategoryWithModel,
): Promise<{ descriptionCategoryId: number; typeId: number; title: string } | null> {
  let nodes = tree;
  let descriptionCategoryId: number | undefined;
  const path: string[] = [];

  for (let depth = 0; depth < 8; depth += 1) {
    const entries = nodes
      .map((node) => ({ node, title: nodeTitle(node) }))
      .filter((entry) => entry.title && !isSensitiveCategory([...path, entry.title].join(" ")));
    if (entries.length === 0) return null;

    const choice = await choose({
      product,
      path,
      candidates: entries.map((entry, index) => ({
        index,
        title: entry.title,
        terminal: Boolean(positiveNumber(entry.node.type_id)),
      })),
    });
    if (choice.confidence < MIN_CATEGORY_CONFIDENCE) {
      throw new Error(`DeepSeek Ozon 类目匹配置信度过低: ${choice.confidence}`);
    }
    const selected = entries[choice.candidateIndex]?.node;
    if (!selected) return null;
    path.push(nodeTitle(selected));
    descriptionCategoryId = positiveNumber(
      selected.description_category_id,
      selected.category_id,
      selected.id,
    ) ?? descriptionCategoryId;
    const typeId = positiveNumber(selected.type_id);
    if (descriptionCategoryId && typeId) {
      return { descriptionCategoryId, typeId, title: path.join(" / ") };
    }
    nodes = Array.isArray(selected.children) ? selected.children : [];
  }
  return null;
}
