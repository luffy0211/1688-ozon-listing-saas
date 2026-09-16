import { describe, expect, it } from "vitest";
import { PIPELINE_STEPS } from "./pipeline";

describe("pipeline steps", () => {
  it("submits to Ozon after compiling the payload", () => {
    expect(PIPELINE_STEPS.at(-2)).toBe("compile_ozon_payload");
    expect(PIPELINE_STEPS.at(-1)).toBe("submit_ozon");
  });
});
