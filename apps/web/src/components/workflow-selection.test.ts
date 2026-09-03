import { describe, expect, it } from "vitest";
import { getWorkflowSelectedProducts, isWorkflowProductSelectable } from "./workflow-selection";

describe("isWorkflowProductSelectable", () => {
  it("blocks submitted and running products from bulk selection", () => {
    expect(isWorkflowProductSelectable({ latestDraftStatus: "SUBMITTED", latestJobStatus: "SUCCEEDED" })).toBe(false);
    expect(isWorkflowProductSelectable({ latestDraftStatus: null, latestJobStatus: "RUNNING" })).toBe(false);
    expect(isWorkflowProductSelectable({ latestDraftStatus: "COMPILED", latestJobStatus: "SUCCEEDED" })).toBe(true);
  });

  it("ignores stale selected ids for products that are no longer selectable", () => {
    const products = [
      { id: "ready", latestDraftStatus: "COMPILED", latestJobStatus: "SUCCEEDED" },
      { id: "submitted", latestDraftStatus: "SUBMITTED", latestJobStatus: "SUCCEEDED" },
      { id: "running", latestDraftStatus: null, latestJobStatus: "RUNNING" },
    ];

    expect(getWorkflowSelectedProducts(products, new Set(["ready", "submitted", "running"]))).toEqual([products[0]]);
  });
});
