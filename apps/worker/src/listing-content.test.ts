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
      '  "hashtagsRu": "#платье #летнееплатье"',
      "}",
      "```",
    ].join("\n");

    expect(parseRussianListingContent(content)).toEqual({
      titleRu: "Женское летнее платье",
      descriptionRu: "Легкое платье для летнего образа.",
      bulletPointsRu: ["Легкая ткань", "Свободный крой"],
      hashtagsRu: "#платье #летнееплатье",
    });
  });
});
