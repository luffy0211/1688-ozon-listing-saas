import { env } from "@/lib/env";

export type ProductImageInput = {
  label: string;
  imageUrl: string | null;
};

export type ProductImageAnalysis = {
  label: string;
  imageUrl: string;
  imageType: string;
  backgroundType: string;
  clarity: "high" | "medium" | "low" | "unknown";
  hasWatermark: boolean | null;
  hasTextOverlay: boolean | null;
  productProminence: "strong" | "medium" | "weak" | "unknown";
  mainImageScore: number | null;
  recommendationZh: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonFromText(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const text = (fenced ?? value).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function normalizeAnalysis(value: unknown, fallback: ProductImageInput): ProductImageAnalysis | null {
  const item = asRecord(value);
  const imageUrl = typeof item.imageUrl === "string" && item.imageUrl ? item.imageUrl : fallback.imageUrl;
  if (!imageUrl) return null;
  const score = typeof item.mainImageScore === "number" && Number.isFinite(item.mainImageScore)
    ? Math.max(0, Math.min(100, item.mainImageScore))
    : null;
  const clarity = ["high", "medium", "low"].includes(String(item.clarity)) ? String(item.clarity) : "unknown";
  const prominence = ["strong", "medium", "weak"].includes(String(item.productProminence))
    ? String(item.productProminence)
    : "unknown";
  return {
    label: typeof item.label === "string" && item.label ? item.label : fallback.label,
    imageUrl,
    imageType: typeof item.imageType === "string" && item.imageType ? item.imageType : "未知",
    backgroundType: typeof item.backgroundType === "string" && item.backgroundType ? item.backgroundType : "未知",
    clarity: clarity as ProductImageAnalysis["clarity"],
    hasWatermark: typeof item.hasWatermark === "boolean" ? item.hasWatermark : null,
    hasTextOverlay: typeof item.hasTextOverlay === "boolean" ? item.hasTextOverlay : null,
    productProminence: prominence as ProductImageAnalysis["productProminence"],
    mainImageScore: score,
    recommendationZh: typeof item.recommendationZh === "string" && item.recommendationZh
      ? item.recommendationZh
      : "图片建议需要人工复核。",
  };
}

export async function analyzeProductImagesWithVision(images: ProductImageInput[]) {
  const selected = images.filter((item): item is ProductImageInput & { imageUrl: string } =>
    Boolean(item.imageUrl),
  ).slice(0, 4);
  if (!env.visionEnabled || !env.visionApiKey || !env.visionModel || !selected.length) {
    return {
      enabled: env.visionEnabled,
      model: env.visionModel,
      analyses: [] as ProductImageAnalysis[],
      warning: env.visionEnabled ? "视觉模型未配置或没有可分析图片。" : "视觉分析未启用。",
    };
  }

  const baseUrl = (env.visionBaseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
  const prompt = [
    "你是 Ozon 电商主图质检助手。只分析图片本身，不要推断不可见事实。",
    "按输入顺序返回 JSON：{ images: [...] }。",
    "每个图片字段：label,imageUrl,imageType,backgroundType,clarity,hasWatermark,hasTextOverlay,productProminence,mainImageScore,recommendationZh。",
    "imageType 用中文，例如白底图、模特图、平铺图、场景图、细节图。",
    "mainImageScore 0-100，评估是否适合做 Ozon 主图。",
  ].join("\n");

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.visionApiKey}`,
      },
      body: JSON.stringify({
        model: env.visionModel,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...selected.flatMap((item, index) => [
              { type: "text", text: `图片${index + 1}：${item.label} ${item.imageUrl}` },
              { type: "image_url", image_url: { url: item.imageUrl } },
            ]),
          ],
        }],
      }),
    });
    if (!response.ok) {
      return {
        enabled: true,
        model: env.visionModel,
        analyses: [] as ProductImageAnalysis[],
        warning: `视觉模型请求失败：${response.status}`,
      };
    }
    const payload = asRecord(await response.json());
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const content = choices.map((choice) => asRecord(asRecord(choice).message).content)
      .find((value): value is string => typeof value === "string") ?? "";
    const parsed = asRecord(jsonFromText(content));
    const rawImages = Array.isArray(parsed.images) ? parsed.images : [];
    return {
      enabled: true,
      model: env.visionModel,
      analyses: rawImages
        .map((item, index) => normalizeAnalysis(item, selected[index] ?? selected[0]!))
        .filter((item): item is ProductImageAnalysis => Boolean(item)),
      warning: null,
    };
  } catch (error) {
    return {
      enabled: true,
      model: env.visionModel,
      analyses: [] as ProductImageAnalysis[],
      warning: `视觉模型调用异常：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
