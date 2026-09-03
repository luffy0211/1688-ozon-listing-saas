import { describe, expect, it } from "vitest";
import { parseRussianListingContent } from "./listing-content";

describe("parseRussianListingContent", () => {
  it("parses model JSON content from fenced output", () => {
    const content = [
      "```json",
      "{",
      '  "titleRu": "Женское летнее платье",',
      '  "descriptionRu": "Легкое платье для летнего образа.",',
      '  "bulletPointsRu": ["Легкая ткань", "Свободный крой"],',
      '  "hashtagsRu": "#платье #летнееплатье",',
      '  "attributesRu": { "material": "полиэстер", "style": "Повседневный", "country": "Китай" }',
      "}",
      "```",
    ].join("\n");

    expect(parseRussianListingContent(content)).toEqual({
      titleRu: "Женское летнее платье",
      descriptionRu: "Легкое платье для летнего образа.",
      bulletPointsRu: ["Легкая ткань", "Свободный крой"],
      hashtagsRu: "#платье #летнееплатье",
      attributesRu: {
        material: "полиэстер",
        style: "Повседневный",
        country: "Китай",
        season: "",
        packageType: "",
        warranty: "",
        pattern: "",
        neckline: "",
        sleeveType: "",
        purpose: "",
        colorName: "",
        packageQuantity: "",
        factoryPackageQuantity: "",
        markingRequired: "",
        unitQuantity: "",
        type: "",
      },
    });
  });
});
