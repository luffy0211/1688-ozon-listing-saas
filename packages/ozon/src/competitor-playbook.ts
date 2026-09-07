import type { CategoryAttribute, OzonAttribute, OzonProductInfoItem } from "./types";

export type PlaybookCompetitor = {
  url: string;
  attributes: Record<string, string>;
  description: string | null;
};

export type CategoryAttributePlaybook = {
  kind: "category_attribute_playbook";
  schemaVersion: 1;
  categoryKey: string;
  descriptionCategoryId: number;
  typeId: number;
  categoryName: string;
  sampleSize: number;
  capturedAt: string;
  attributes: Array<{
    competitorNameRu: string;
    ozonAttributeId: number | null;
    ozonNameRu: string | null;
    required: boolean;
    dictionaryId: number | null;
    coverageCount: number;
    coverageRate: number;
    mappingStatus: "EXACT" | "UNMAPPED";
    commonValues: Array<{
      value: string;
      count: number;
      rate: number;
      dictionaryValueId: number | null;
    }>;
    evidenceUrls: string[];
  }>;
  descriptionPatterns: {
    availableCount: number;
    averageLength: number;
    samples: Array<{ url: string; text: string }>;
  };
};

export type ProductAttributeRecommendation = {
  ozonAttributeId: number | null;
  ozonNameRu: string | null;
  competitorNameRu: string;
  required: boolean;
  status: "COMPLETE" | "ADD" | "NEEDS_CONFIRMATION" | "UNMAPPED";
  currentValues: string[];
  suggestedValue: string | null;
  dictionaryValueId: number | null;
  evidenceSource: "OWN_CONTENT" | "COMPETITOR_ONLY" | "CURRENT_PRODUCT" | "NONE";
  competitorCoverageRate: number;
  evidenceUrls: string[];
  reasonZh: string;
};

export type ProductAttributeRecommendationResult = {
  offerId: string;
  productId: string | null;
  categoryKey: string;
  categoryMatches: boolean;
  recommendations: ProductAttributeRecommendation[];
  actionableCount: number;
  actionAttributes: OzonAttribute[] | null;
};

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeOzonAttributeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function attributeId(attribute: CategoryAttribute) {
  return finiteNumber(attribute.attribute_id) ?? finiteNumber(attribute.id);
}

function attributeName(attribute: CategoryAttribute) {
  return (attribute.attribute_name || attribute.name || "").trim();
}

function splitValues(value: string) {
  return [...new Set(value.split(/[,;|]+/).map((part) => part.trim()).filter(Boolean))];
}

function exactDictionaryValue(
  values: Array<{ id?: number; dictionary_value_id?: number; value: string }>,
  desired: string,
) {
  const normalized = normalizeOzonAttributeText(desired);
  const match = values.find((item) => normalizeOzonAttributeText(item.value) === normalized);
  return match ? finiteNumber(match.dictionary_value_id) ?? finiteNumber(match.id) : null;
}

export function buildCategoryAttributePlaybook(params: {
  descriptionCategoryId: number;
  typeId: number;
  categoryName: string;
  categoryAttributes: CategoryAttribute[];
  competitors: PlaybookCompetitor[];
  dictionaryValues?: Map<number, Array<{ id: number; value: string }>>;
  capturedAt?: string;
}): CategoryAttributePlaybook {
  const officialByName = new Map<string, CategoryAttribute>();
  params.categoryAttributes.forEach((attribute) => {
    const name = attributeName(attribute);
    if (name) officialByName.set(normalizeOzonAttributeText(name), attribute);
  });

  const patterns = new Map<string, {
    displayName: string;
    coverageCount: number;
    values: Map<string, { displayValue: string; count: number }>;
    urls: Set<string>;
  }>();
  params.competitors.forEach((competitor) => {
    const seen = new Set<string>();
    Object.entries(competitor.attributes).forEach(([rawName, rawValue]) => {
      const name = rawName.trim();
      const key = normalizeOzonAttributeText(name);
      if (!key || !rawValue.trim()) return;
      const pattern = patterns.get(key) ?? {
        displayName: name,
        coverageCount: 0,
        values: new Map(),
        urls: new Set(),
      };
      if (!seen.has(key)) {
        pattern.coverageCount += 1;
        pattern.urls.add(competitor.url);
        seen.add(key);
      }
      splitValues(rawValue).forEach((value) => {
        const valueKey = normalizeOzonAttributeText(value);
        const current = pattern.values.get(valueKey);
        pattern.values.set(valueKey, {
          displayValue: current?.displayValue ?? value,
          count: (current?.count ?? 0) + 1,
        });
      });
      patterns.set(key, pattern);
    });
  });

  const sampleSize = params.competitors.length;
  const mappedIds = new Set<number>();
  const attributes: CategoryAttributePlaybook["attributes"] = [...patterns.entries()].map(([key, pattern]) => {
    const official = officialByName.get(key);
    const id = official ? attributeId(official) : null;
    if (id) mappedIds.add(id);
    const allowedValues = official
      ? [
          ...(official.allowed_values ?? []),
          ...(id ? params.dictionaryValues?.get(id) ?? [] : []),
        ]
      : [];
    return {
      competitorNameRu: pattern.displayName,
      ozonAttributeId: id,
      ozonNameRu: official ? attributeName(official) : null,
      required: Boolean(official?.is_required || official?.required),
      dictionaryId: official ? finiteNumber(official.dictionary_id) : null,
      coverageCount: pattern.coverageCount,
      coverageRate: sampleSize ? pattern.coverageCount / sampleSize : 0,
      mappingStatus: official && id ? "EXACT" : "UNMAPPED",
      commonValues: [...pattern.values.values()]
        .sort((a, b) => b.count - a.count || a.displayValue.localeCompare(b.displayValue, "ru"))
        .slice(0, 5)
        .map(({ displayValue, count }) => ({
          value: displayValue,
          count,
          rate: sampleSize ? count / sampleSize : 0,
          dictionaryValueId: exactDictionaryValue(allowedValues, displayValue),
        })),
      evidenceUrls: [...pattern.urls],
    };
  });

  params.categoryAttributes.forEach((official) => {
    const id = attributeId(official);
    if (!id || mappedIds.has(id) || !(official.is_required || official.required)) return;
    attributes.push({
      competitorNameRu: attributeName(official),
      ozonAttributeId: id,
      ozonNameRu: attributeName(official),
      required: true,
      dictionaryId: finiteNumber(official.dictionary_id),
      coverageCount: 0,
      coverageRate: 0,
      mappingStatus: "EXACT",
      commonValues: [],
      evidenceUrls: [],
    });
  });

  const descriptions = params.competitors.filter(
    (item): item is PlaybookCompetitor & { description: string } => Boolean(item.description?.trim()),
  );
  return {
    kind: "category_attribute_playbook",
    schemaVersion: 1,
    categoryKey: `${params.descriptionCategoryId}:${params.typeId}`,
    descriptionCategoryId: params.descriptionCategoryId,
    typeId: params.typeId,
    categoryName: params.categoryName,
    sampleSize,
    capturedAt: params.capturedAt ?? new Date().toISOString(),
    attributes: attributes.sort(
      (a, b) => b.coverageCount - a.coverageCount || Number(b.required) - Number(a.required),
    ),
    descriptionPatterns: {
      availableCount: descriptions.length,
      averageLength: descriptions.length
        ? Math.round(descriptions.reduce((total, item) => total + item.description.length, 0) / descriptions.length)
        : 0,
      samples: descriptions.slice(0, 3).map((item) => ({
        url: item.url,
        text: item.description.slice(0, 500),
      })),
    },
  };
}

function productCategoryKey(product: OzonProductInfoItem) {
  return `${finiteNumber(product.description_category_id) ?? 0}:${finiteNumber(product.type_id) ?? 0}`;
}

function productEvidence(product: OzonProductInfoItem) {
  return normalizeOzonAttributeText([
    product.name,
    product.description,
    ...(product.attributes ?? []).flatMap((attribute) => attribute.values.map((item) => item.value)),
  ].filter((item): item is string => typeof item === "string").join(" "));
}

function containsCompleteValue(haystack: string, value: string) {
  const needle = normalizeOzonAttributeText(value);
  return needle.length >= 3 && ` ${haystack} `.includes(` ${needle} `);
}

export function buildProductAttributeRecommendations(params: {
  playbook: CategoryAttributePlaybook;
  product: OzonProductInfoItem;
}): ProductAttributeRecommendationResult {
  const offerId = String(params.product.offer_id ?? "");
  const productId = params.product.product_id ?? params.product.id;
  const categoryMatches = productCategoryKey(params.product) === params.playbook.categoryKey;
  if (!categoryMatches) {
    return {
      offerId,
      productId: productId == null ? null : String(productId),
      categoryKey: productCategoryKey(params.product),
      categoryMatches: false,
      recommendations: [],
      actionableCount: 0,
      actionAttributes: null,
    };
  }

  const existing = params.product.attributes ?? [];
  const existingById = new Map(existing.map((attribute) => [attribute.id, attribute]));
  const ownEvidence = productEvidence(params.product);
  const additions: OzonAttribute[] = [];
  const recommendations = params.playbook.attributes.map((experience): ProductAttributeRecommendation => {
    const base = {
      ozonAttributeId: experience.ozonAttributeId,
      ozonNameRu: experience.ozonNameRu,
      competitorNameRu: experience.competitorNameRu,
      required: experience.required,
      competitorCoverageRate: experience.coverageRate,
      evidenceUrls: experience.evidenceUrls,
    };
    if (!experience.ozonAttributeId) {
      return {
        ...base,
        status: "UNMAPPED",
        currentValues: [],
        suggestedValue: experience.commonValues[0]?.value ?? null,
        dictionaryValueId: null,
        evidenceSource: "NONE",
        reasonZh: "竞品属性尚未准确映射到 Ozon 官方属性，不能自动修改。",
      };
    }
    const current = existingById.get(experience.ozonAttributeId);
    if (current?.values.length) {
      return {
        ...base,
        status: "COMPLETE",
        currentValues: current.values.map((item) => item.value),
        suggestedValue: null,
        dictionaryValueId: null,
        evidenceSource: "CURRENT_PRODUCT",
        reasonZh: "自家商品已经填写该属性，竞品常用值不会覆盖现有事实。",
      };
    }
    const candidate = experience.commonValues.find((item) => {
      return containsCompleteValue(ownEvidence, item.value);
    }) ?? experience.commonValues[0] ?? null;
    const hasOwnEvidence = candidate ? containsCompleteValue(ownEvidence, candidate.value) : false;
    const dictionaryReady = !experience.dictionaryId || candidate?.dictionaryValueId;
    if (candidate && hasOwnEvidence && dictionaryReady) {
      const attribute = {
        id: experience.ozonAttributeId,
        values: [{
          value: candidate.value,
          ...(candidate.dictionaryValueId ? { dictionaryValueId: candidate.dictionaryValueId } : {}),
        }],
      };
      additions.push(attribute);
      return {
        ...base,
        status: "ADD",
        currentValues: [],
        suggestedValue: candidate.value,
        dictionaryValueId: candidate.dictionaryValueId,
        evidenceSource: "OWN_CONTENT",
        reasonZh: "自家标题、描述或现有属性中存在该值，可作为补充依据。",
      };
    }
    return {
      ...base,
      status: "NEEDS_CONFIRMATION",
      currentValues: [],
      suggestedValue: candidate?.value ?? null,
      dictionaryValueId: candidate?.dictionaryValueId ?? null,
      evidenceSource: candidate ? "COMPETITOR_ONLY" : "NONE",
      reasonZh: experience.required
        ? "Ozon 必填属性缺失，但自家商品信息不足，需要人工确认真实值。"
        : "竞品经常填写该属性，但不能把竞品值直接当作自家商品事实。",
    };
  });

  return {
    offerId,
    productId: productId == null ? null : String(productId),
    categoryKey: params.playbook.categoryKey,
    categoryMatches,
    recommendations,
    actionableCount: additions.length,
    actionAttributes: additions.length ? additions : null,
  };
}

export function parseCategoryAttributePlaybook(value: unknown): CategoryAttributePlaybook | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<CategoryAttributePlaybook>;
  if (
    item.kind !== "category_attribute_playbook" ||
    item.schemaVersion !== 1 ||
    !Number.isFinite(item.descriptionCategoryId) ||
    !Number.isFinite(item.typeId) ||
    item.categoryKey !== `${item.descriptionCategoryId}:${item.typeId}` ||
    typeof item.categoryName !== "string" ||
    !Array.isArray(item.attributes) ||
    !item.attributes.every((attribute) =>
      attribute &&
      typeof attribute.competitorNameRu === "string" &&
      (attribute.ozonAttributeId === null || Number.isFinite(attribute.ozonAttributeId)) &&
      (attribute.ozonNameRu === null || typeof attribute.ozonNameRu === "string") &&
      typeof attribute.required === "boolean" &&
      (attribute.dictionaryId === null || Number.isFinite(attribute.dictionaryId)) &&
      Number.isFinite(attribute.coverageCount) &&
      Number.isFinite(attribute.coverageRate) &&
      (attribute.mappingStatus === "EXACT" || attribute.mappingStatus === "UNMAPPED") &&
      Array.isArray(attribute.commonValues) && attribute.commonValues.every((common) =>
        common &&
        typeof common.value === "string" &&
        Number.isFinite(common.count) &&
        Number.isFinite(common.rate) &&
        (common.dictionaryValueId === null || Number.isFinite(common.dictionaryValueId)),
      ) &&
      Array.isArray(attribute.evidenceUrls) &&
      attribute.evidenceUrls.every((url) => typeof url === "string"),
    )
  ) return null;
  return item as CategoryAttributePlaybook;
}
