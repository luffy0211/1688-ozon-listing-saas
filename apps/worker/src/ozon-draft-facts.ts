import type { CategoryAttribute, CategoryNode, OzonAttribute } from "@saas/ozon";
import type { NormalizedProductFact } from "@saas/core";
import type { RussianClothingAttributes } from "./listing-content";

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
  attributesRu?: RussianClothingAttributes;
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
  if (/大衣|外套|风衣|毛呢|羊毛|羊绒|coat|overcoat/i.test(text)) return ["пальто"];
  if (/开衫|cardigan/i.test(text)) return ["кардиган"];
  if (/毛衣|sweater/i.test(text)) return ["свитер"];
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
  if (/羊绒/.test(value)) return "кашемир";
  if (/羊毛/.test(value)) return "шерсть";
  if (/涤纶|聚酯/.test(value)) return "полиэстер";
  if (/棉/.test(value)) return "хлопок";
  if (/麻/.test(value)) return "лен";
  if (/醋酯/.test(value)) return "ацетат";
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

function primaryAttrName(attribute: CategoryAttribute): string {
  return String(attribute.name ?? attribute.attribute_name ?? "").toLowerCase();
}

function isSafeOptionalListingAttribute(attribute: CategoryAttribute): boolean {
  const name = primaryAttrName(attribute);
  return (
    /хештег|аннотац|rich|код продавца|размер производител|тип упаковки одежды|страна-изготовитель|вес с упаковкой|стиль|коллекция|назначение|количество в упаковке|название цвета|гарантия|количество заводских упаковок|нужен код маркировки|тип рукава|рисунок|вырез горловины|количество товара в уеи/i.test(name) ||
    ["название", "материал", "состав материала"].includes(name)
  );
}

function templateValue(
  content: OzonAttributeContent,
  key: keyof RussianClothingAttributes,
  fallback: string,
): string {
  return content.attributesRu?.[key] || fallback;
}

function seasonValue(fact: NormalizedProductFact): string {
  const season = propertyValue(fact, /上市年份\/季节|季节|season/i);
  const year = season.match(/20\d{2}/)?.[0];
  if (/春|夏/.test(season)) return year ? `Весна-лето ${year}` : "Весна-лето";
  if (/秋|冬/.test(season)) return year ? `Осень-зима ${year}` : "Осень-зима";
  return "Всесезон";
}

function seasonTemplateValue(content: OzonAttributeContent, fact: NormalizedProductFact): string {
  const value = content.attributesRu?.season ?? "";
  const fallback = seasonValue(fact);
  if (/\d/.test(value)) return value;
  if (/\d/.test(fallback)) return fallback;
  return value || fallback;
}

function styleValue(fact: NormalizedProductFact): string {
  const style = propertyValue(fact, /风格|style/i);
  if (/通勤|气质|简约|ol/i.test(style)) return "Деловой";
  if (/休闲|日常/i.test(style)) return "Повседневный";
  if (/优雅|淑女/i.test(style)) return "Романтический";
  return "Повседневный";
}

function patternValue(fact: NormalizedProductFact): string {
  const pattern = propertyValue(fact, /图案|pattern/i);
  if (/纯色/.test(pattern)) return "Однотонный";
  if (/花|碎花/.test(pattern)) return "Цветочный";
  if (/条纹/.test(pattern)) return "Полоска";
  return "";
}

function sleeveValue(fact: NormalizedProductFact): string {
  const sleeve = propertyValue(fact, /袖长|袖型|sleeve/i);
  if (/长袖/.test(sleeve)) return "Длинный рукав";
  if (/短袖/.test(sleeve)) return "Короткий рукав";
  if (/无袖/.test(sleeve)) return "Без рукавов";
  return "";
}

function necklineValue(fact: NormalizedProductFact): string {
  const neckline = propertyValue(fact, /领型|领口|neck/i);
  if (/翻领/.test(neckline)) return "Отложной воротник";
  if (/v|V/.test(neckline)) return "V-образный";
  if (/圆/.test(neckline)) return "Круглый";
  return "";
}

function desiredValue(
  attribute: CategoryAttribute,
  fact: NormalizedProductFact,
  titleRu: string,
  content: OzonAttributeContent = {},
): string {
  const primary = primaryAttrName(attribute);
  const name = attrName(attribute);
  if (/хештег/i.test(primary)) return content.searchKeywordsRu || `#одежда #мода #${titleRu.split(" ")[0] ?? "fashion"}`;
  if (/аннотац/i.test(primary)) return [content.descriptionRu, ...(content.bulletPointsRu ?? [])].filter(Boolean).join("<br/><br/>") || titleRu;
  if (/rich/i.test(primary)) return richContentJson(content.detailImages ?? fact.detailImages);
  if (/код продавца/i.test(primary)) return fact.skus[0]?.skuId ?? titleRu;
  if (/размер производител/i.test(primary)) return manufacturerSize(fact);
  if (primary === "название" || /модель|model/i.test(primary)) return titleRu;
  if (/тип упаков/i.test(primary)) return templateValue(content, "packageType", "Пакет");
  if (primary === "тип" || /(^|\s)(тип|вид)($|\s)/i.test(primary)) return /пальто|大衣|外套|羊毛|羊绒|coat/i.test(productText(fact, titleRu)) ? "пальто" : /裙|dress/i.test(textOfFact(fact)) ? "платье" : titleRu;
  if (/пол|gender/i.test(primary)) return "женский";
  if (/объединить|combine/i.test(name)) return `listing-${fact.skus[0]?.skuId ?? titleRu}`;
  if (/бренд|brand|торговая марка/i.test(name)) return "Нет бренда";
  if (/российский размер/i.test(name)) return russianSize(manufacturerSize(fact));
  if (/цвет|color/i.test(name)) return ruColor(propertyValue(fact, /цвет|颜色/i));
  if (/название цвета/i.test(primary)) return templateValue(content, "colorName", ruColor(propertyValue(fact, /цвет|颜色/i)));
  if (/материал|состав|material/i.test(name)) return templateValue(content, "material", ruMaterial(propertyValue(fact, /面料|材质|成分|毛种类/i)));
  if (/размер|size/i.test(name)) return manufacturerSize(fact);
  if (/страна/i.test(name)) return templateValue(content, "country", "Китай");
  if (/коллекц|сезон/i.test(name)) return seasonTemplateValue(content, fact);
  if (/стиль/i.test(name)) return templateValue(content, "style", styleValue(fact));
  if (/назначен/i.test(name)) return templateValue(content, "purpose", "для повседневной носки");
  if (/тип рукава/i.test(name)) return templateValue(content, "sleeveType", sleeveValue(fact));
  if (/рисунок/i.test(name)) return templateValue(content, "pattern", patternValue(fact));
  if (/вырез/i.test(name)) return templateValue(content, "neckline", necklineValue(fact));
  if (/вес с упаковкой/i.test(name)) return String(packageDefaults(fact).weightGrams);
  if (/гарантия/i.test(name)) return templateValue(content, "warranty", "Без гарантии");
  if (/нужен код маркировки|маркиров/i.test(name)) return templateValue(content, "markingRequired", "false");
  if (/количество заводских упаковок/i.test(name)) return templateValue(content, "factoryPackageQuantity", "1");
  if (/количество товара в уеи/i.test(name)) return templateValue(content, "unitQuantity", "1");
  if (/количество|упаков/i.test(name)) return templateValue(content, "packageQuantity", "1");
  return titleRu;
}

function bestDictionaryValue(
  values: Array<{ id?: number; dictionary_value_id?: number; value: string }>,
  desired: string,
): { value: string; dictionaryValueId?: number } | null {
  if (values.length === 0) return null;
  const normalized = desired.toLowerCase();
  const match =
    values.find((item) => item.value.toLowerCase() === normalized) ??
    values.find((item) => item.value.toLowerCase().includes(normalized)) ??
    values.find((item) => normalized.includes(item.value.toLowerCase()));
  if (!match) return null;
  return {
    value: match.value,
    dictionaryValueId: firstNumber(match.dictionary_value_id, match.id),
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
    let value = bestDictionaryValue(localValues, desired);
    if (!value) {
      remoteValues = await loadValues(id).catch(() => []);
      value = bestDictionaryValue(remoteValues, desired);
    }
    if (!required && !value && (localValues.length > 0 || remoteValues.length > 0)) continue;
    byId.set(id, {
      id,
      values: [value ?? { value: desired }],
    });
  }
  return [...byId.values()];
}
