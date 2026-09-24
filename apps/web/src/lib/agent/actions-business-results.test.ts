import { describe, expect, it } from "vitest";

import { assertOzonMutationSucceeded, isUncertainOzonWriteError } from "./actions";

describe("Ozon mutation business results", () => {
  it("rejects HTTP 200 responses whose item was not updated", () => {
    expect(() => assertOzonMutationSucceeded({
      result: [{ offer_id: "SKU-1", updated: false, errors: [{ code: "INVALID_STOCK" }] }],
    })).toThrow("ozon_mutation_rejected");
  });

  it("accepts successful per-item mutation results", () => {
    expect(assertOzonMutationSucceeded({
      result: [{ offer_id: "SKU-1", updated: true, errors: [] }],
    })).toEqual({ updatedCount: 1, rejectedCount: 0 });
  });

  it("reports partial batch results instead of flattening them to success", () => {
    expect(() => assertOzonMutationSucceeded({
      result: [
        { offer_id: "SKU-1", updated: true, errors: [] },
        { offer_id: "SKU-2", updated: false, errors: [{ message: "bad value" }] },
      ],
    })).toThrow("ozon_mutation_partial");
  });

  it("rejects empty business results because HTTP success is not mutation proof", () => {
    expect(() => assertOzonMutationSucceeded({ result: { items: [] } })).toThrow(
      "ozon_mutation_unknown",
    );
  });

  it("distinguishes uncertain transport failures from explicit business rejection", () => {
    expect(isUncertainOzonWriteError(new Error("request timeout after socket hang up"))).toBe(true);
    expect(isUncertainOzonWriteError(new Error("ozon_mutation_rejected:INVALID_STOCK"))).toBe(false);
  });
});
