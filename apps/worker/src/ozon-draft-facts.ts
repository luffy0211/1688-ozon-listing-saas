import type { CategoryAttribute, CategoryNode, OzonAttribute } from "@saas/ozon";
import type { NormalizedProductFact } from "@saas/core";

type JsonRecord = Record<string, unknown>;

export type OzonDraftFacts = {
  descriptionCategoryId?: number;
  typeId?: number;
  attributes: OzonAttribute[];
  weightGrams?: number;
  dimensions: {
    widthMm?: number;
    heightMm?: number;
    depthMm?: number;
  };
};

export type OzonAttributeContent = {
  descriptionRu?: string;
  bulletPointsRu?: string[];
  searchKeywordsRu?: string;
  detailImages?: string[];
};

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function parseOzonAttributes(value: unknown): OzonAttribute[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawAttribute) => {
    const attribute = asRecord(rawAttribute);
    const id = firstNumber(attribute.id, attribute.attribute_id);
    const values = Array.isArray(attribute.values) ? attribute.values : [];
    if (!id || values.length === 0) return [];
    const parsedValues = values.flatMap((rawValue) => {
      const item = asRecord(rawValue);
      const text = firstString(item.value);
      if (!text) return [];
      return [
        {
          value: text,
          dictionaryValueId: firstNumber(
            item.dictionaryValueId,
            item.dictionary_value_id,
            item.id,
          ),
        },
      ];
    });
    return parsedValues.length > 0 ? [{ id, values: parsedValues }] : [];
  });
}

export function ozonDraftFacts(raw: unknown): OzonDraftFacts {
  const root = asRecord(raw);
  const ozon = asRecord(root.ozon);
  return {
    descriptionCategoryId: firstNumber(
      ozon.descriptionCategoryId,
      ozon.description_category_id,
      root.descriptionCategoryId,
      root.description_category_id,
      root.ozonCategoryId,
      root.ozon_category_id,
    ),
    typeId: firstNumber(ozon.typeId, ozon.type_id, root.typeId, root.type_id),
    attributes: parseOzonAttributes(ozon.attributes).length
      ? parseOzonAttributes(ozon.attributes)
      : parseOzonAttributes(root.ozonAttributes),
    weightGrams: firstNumber(
      ozon.weightGrams,
      ozon.weight_g,
      root.weightGrams,
      root.weight_g,
      root.weight,
    ),
    dimensions: {
      widthMm: firstNumber(ozon.widthMm, ozon.width_mm, root.widthMm, root.width_mm, root.width),
      heightMm: firstNumber(ozon.heightMm, ozon.height_mm, root.heightMm, root.height_mm, root.height),
      depthMm: firstNumber(ozon.depthMm, ozon.depth_mm, root.depthMm, root.depth_mm, root.depth),
    },
  };
}

function textOfFact(fact: NormalizedProductFact): string {
  return [
    fact.title,
    ...fact.categoryPath,
    ...fact.properties.flatMap((p) => [p.name, p.value]),
  ].join(" ");
}

function nodeTitle(node: CategoryNode): string {
  return [
    node.title,
    node.category_name,
    node.type_name,
    node.name,
  ].filter(Boolean).join(" ");
}

function nodeCategoryId(node: CategoryNode): number | undefined {
  return firstNumber(node.description_category_id, node.category_id, node.id);
}

function nodeTypeId(node: CategoryNode): number | undefined {
  return firstNumber(node.type_id);
}

function childrenOf(node: CategoryNode): CategoryNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

function searchTerms(fact: NormalizedProductFact): string[] {
  const text = textOfFact(fact);
  if (/连衣裙|女裙|裙子|dress/i.test(text)) return ["плать", "сарафан"];
  if (/裤|pants|trousers/i.test(text)) return ["брюк", "штан"];
  if (/上衣|衬衫|shirt|blouse/i.test(text)) return ["блуз", "рубаш"];
  return [];
}

export function matchOzonCategory(
  tree: CategoryNode[],
  fact: NormalizedProductFact,
): { descriptionCategoryId: number; typeId: number; title: string } | null {
  const terms = searchTerms(fact);
  if (terms.length === 0) return null;

  let best: { descriptionCategoryId: number; typeId: number; title: string; score: number } | null = null;

  const visit = (node: CategoryNode, path: string[], inheritedCategoryId?: number) => {
    const title = nodeTitle(node);
    const nextPath = title ? [...path, title] : path;
    const descriptionCategoryId = nodeCategoryId(node) ?? inheritedCategoryId;
    const typeId = nodeTypeId(node);
    const combined = nextPath.join(" ").toLowerCase();

    if (descriptionCategoryId && typeId) {
      const termScore = terms.reduce(
        (score, term) => score + (combined.includes(term) ? 10 : 0),
        0,
      );
      const genderScore = /жен|women|woman/i.test(combined) ? 3 : 0;
      const score = termScore + genderScore + nextPath.length;
      if (score > 0 && (!best || score > best.score)) {
        best = {
          descriptionCategoryId,
          typeId,
          title: nextPath.join(" / "),
          score,
        };
      }
    }

    for (const child of childrenOf(node)) {
      visit(child, nextPath, descriptionCategoryId);
    }
  };

  for (const node of tree) visit(node, []);
  return best;
}

export function packageDefaults(fact: NormalizedProductFact): Required<Pick<OzonDraftFacts, "weightGrams" | "dimensions">> {
  const text = textOfFact(fact);
  if (/连衣裙|女裙|裙子|dress/i.test(text)) {
    return { weightGrams: 500, dimensions: { widthMm: 300, heightMm: 250, depthMm: 40 } };
  }
  return { weightGrams: 500, dimensions: { widthMm: 300, heightMm: 250, depthMm: 50 } };
}

function propertyValue(fact: NormalizedProductFact, name: RegExp): string {
  return fact.properties.find((p) => name.test(p.name))?.value ?? "";
}

function ruColor(value: string): string {
  if (/黑/.test(value)) return "черный";
  if (/白/.test(value)) return "белый";
  if (/红/.test(value)) return "красный";
  if (/粉/.test(value)) return "розовый";
  if (/蓝/.test(value)) return "синий";
  if (/绿/.test(value)) return "зеленый";
  if (/灰/.test(value)) return "серый";
  if (/米|杏|裸/.test(value)) return "бежевый";
  return "разноцветный";
}

function ruMaterial(value: string): string {
  if (/涤纶|聚酯/.test(value)) return "полиэстер";
  if (/棉/.test(value)) return "хлопок";
  if (/麻/.test(value)) return "лен";
  if (/粘纤|人棉/.test(value)) return "вискоза";
  return "полиэстер";
}

function manufacturerSize(fact: NormalizedProductFact): string {
  const size = fact.skus[0]?.attributes["尺码"] ?? propertyValue(fact, /尺码|尺寸|size/i);
  return size || "L";
}

function russianSize(size: string): string {
  const normalized = size.toUpperCase();
  if (normalized.includes("XXL")) return "52";
  if (normalized.includes("XL")) return "50";
  if (normalized.includes("L")) return "48";
  if (normalized.includes("M")) return "46";
  if (normalized.includes("S")) return "44";
  return "48";
}

function productText(fact: NormalizedProductFact, titleRu: string): string {
  return `${textOfFact(fact)} ${titleRu}`;
}

function richContentJson(images: string[]): string {
  const src = images[0];
  if (!src) return "";
  return JSON.stringify({
    content: [
      {
        widgetName: "raShowcase",
        type: "roll",
        blocks: [
          {
            imgLink: "",
            img: {
              src,
              srcMobile: src,
              alt: "",
              position: "width_full",
              positionMobile: "width_full",
              widthMobile: 750,
              heightMobile: 1000,
            },
          },
        ],
      },
    ],
    version: 0.3,
  });
}

function attrName(attribute: CategoryAttribute): string {
  return [
    attribute.name,
    attribute.attribute_name,
    attribute.description,
  ].filter(Boolean).join(" ").toLowerCase();
}

function isSafeOptionalListingAttribute(attribute: CategoryAttribute): boolean {
  const name = attrName(attribute);
  return /хештег|аннотац|rich|название|код продавца|размер производител/i.test(name);
}

function desiredValue(
  attribute: CategoryAttribute,
  fact: NormalizedProductFact,
  titleRu: string,
  content: OzonAttributeContent = {},
): string {
  const name = attrName(attribute);
  if (/объединить|combine/i.test(name)) return `listing-${fact.skus[0]?.skuId ?? titleRu}`;
  if (/бренд|brand|торговая марка/i.test(name)) return "Нет бренда";
  if (/хештег/i.test(name)) return content.searchKeywordsRu || `#одежда #мода #${titleRu.split(" ")[0] ?? "fashion"}`;
  if (/аннотац/i.test(name)) return [content.descriptionRu, ...(content.bulletPointsRu ?? [])].filter(Boolean).join("<br/><br/>") || titleRu;
  if (/rich/i.test(name)) return richContentJson(content.detailImages ?? fact.detailImages);
  if (/российский размер/i.test(name)) return russianSize(manufacturerSize(fact));
  if (/размер производител/i.test(name)) return manufacturerSize(fact);
  if (/цвет|color/i.test(name)) return ruColor(propertyValue(fact, /цвет|颜色/i));
  if (/материал|состав|material/i.test(name)) return ruMaterial(propertyValue(fact, /面料|材质|成分/i));
  if (/размер|size/i.test(name)) return manufacturerSize(fact);
  if (/пол|gender/i.test(name)) return "женский";
  if (/страна/i.test(name)) return "Китай";
  if (/коллекц|сезон/i.test(name)) return /лет|夏|summer/i.test(productText(fact, titleRu)) ? "Весна-лето 2027" : "Всесезон";
  if (/стиль/i.test(name)) return /плать|жен|女|dress/i.test(productText(fact, titleRu)) ? "Повседневный" : "Деловой";
  if (/назначен/i.test(name)) return "для повседневной носки";
  if (/тип рукава/i.test(name)) return /без рукав|无袖/i.test(productText(fact, titleRu)) ? "Без рукавов" : "Короткий рукав";
  if (/рисунок/i.test(name)) return /цвет|花|принт/i.test(productText(fact, titleRu)) ? "Цветочный" : "Однотонный";
  if (/вырез/i.test(name)) return /v-?neck|v领|v-образ/i.test(productText(fact, titleRu)) ? "V-образный" : "Круглый";
  if (/вес с упаковкой/i.test(name)) return String(packageDefaults(fact).weightGrams);
  if (/код продавца/i.test(name)) return fact.skus[0]?.skuId ?? titleRu;
  if (/тип упаков/i.test(name)) return "Пакет";
  if (/количество|упаков|маркиров/i.test(name)) return /маркиров/i.test(name) ? "false" : "1";
  if (/модель|model|название/i.test(name)) return titleRu;
  if (/тип|вид|type/i.test(name)) return /裙|dress/i.test(textOfFact(fact)) ? "платье" : titleRu;
  return titleRu;
}

function bestDictionaryValue(
  values: Array<{ id?: number; dictionary_value_id?: number; value: string }>,
  desired: string,
  allowFallback = true,
): { value: string; dictionaryValueId?: number } | null {
  if (values.length === 0) return null;
  const normalized = desired.toLowerCase();
  const fallback = values[0];
  if (!fallback) return null;
  const match =
    values.find((item) => item.value.toLowerCase() === normalized) ??
    values.find((item) => item.value.toLowerCase().includes(normalized)) ??
    values.find((item) => normalized.includes(item.value.toLowerCase()));
  if (!match && !allowFallback) return null;
  const selected = match ?? fallback;
  return {
    value: selected.value,
    dictionaryValueId: firstNumber(selected.dictionary_value_id, selected.id),
  };
}

export async function buildRequiredOzonAttributes(
  fact: NormalizedProductFact,
  titleRu: string,
  categoryAttributes: CategoryAttribute[],
  existing: OzonAttribute[],
  loadValues: (attributeId: number) => Promise<Array<{ id: number; value: string }>>,
  content: OzonAttributeContent = {},
): Promise<OzonAttribute[]> {
  const byId = new Map(existing.map((attribute) => [attribute.id, attribute]));
  for (const attribute of categoryAttributes) {
    const id = firstNumber(attribute.id, attribute.attribute_id);
    const required = Boolean(attribute.is_required || attribute.required);
    if (!id || byId.has(id) || !(required || isSafeOptionalListingAttribute(attribute))) continue;

    const desired = desiredValue(attribute, fact, titleRu, content);
    if (!desired) continue;
    const localValues = attribute.allowed_values ?? [];
    let remoteValues: Array<{ id: number; value: string }> = [];
    let value = bestDictionaryValue(localValues, desired, required);
    if (!value) {
      remoteValues = await loadValues(id).catch(() => []);
      value = bestDictionaryValue(remoteValues, desired, required);
    }
    if (!required && !value && (localValues.length > 0 || remoteValues.length > 0)) continue;
    byId.set(id, {
      id,
      values: [value ?? { value: desired }],
    });
  }
  return [...byId.values()];
}
