import { describe, expect, it } from "vitest";
import { parseTranslationArray } from "./translate-text";

describe("parseTranslationArray", () => {
  it("accepts a same-length JSON string array", () => {
    expect(parseTranslationArray("[\"one\",\"two\"]", 2)).toEqual(["one", "two"]);
  });

  it("rejects wrong-length translation output", () => {
    expect(() => parseTranslationArray("[\"one\"]", 2)).toThrow("数量不匹配");
  });
});
