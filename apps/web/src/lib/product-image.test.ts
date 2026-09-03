import { describe, expect, it } from "vitest";
import { preferredProductImageUrl } from "./product-image";

describe("preferredProductImageUrl", () => {
  it("prefers main images over sku and detail images", () => {
    expect(
      preferredProductImageUrl([
        { kind: "detail_image", sourceUrl: "https://img.test/detail.jpg" },
        { kind: "sku_image", sourceUrl: "https://img.test/sku.jpg" },
        { kind: "main_image", sourceUrl: "https://img.test/main.jpg" },
      ]),
    ).toBe("https://img.test/main.jpg");
  });

  it("falls back to sku, then any usable image", () => {
    expect(
      preferredProductImageUrl([
        { kind: "detail_image", sourceUrl: "https://img.test/detail.jpg" },
        { kind: "sku_image", publicUrl: "https://cdn.test/sku.jpg" },
      ]),
    ).toBe("https://cdn.test/sku.jpg");

    expect(preferredProductImageUrl([{ kind: "unknown", sourceUrl: "https://img.test/any.jpg" }])).toBe(
      "https://img.test/any.jpg",
    );
  });
});
