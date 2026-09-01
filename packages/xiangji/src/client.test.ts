import { describe, expect, it } from "vitest";
import { XiangjiClient } from "./client";

describe("XiangjiClient", () => {
  it("returns non-Chinese text in Russian mock translation", async () => {
    const client = new XiangjiClient({ apiKey: "mock", textMock: true });

    const translated = await client.translateText(["中文标题", "中文描述"]);

    expect(translated).toHaveLength(2);
    expect(JSON.stringify(translated)).not.toMatch(/[\u3400-\u4dbf\u4e00-\u9fff]/);
  });
});
