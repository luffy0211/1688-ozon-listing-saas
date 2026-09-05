import { describe, expect, it } from "vitest";
import {
  getWorkflowSelectedProducts,
  getWorkflowBatchProgress,
  getWorkflowJobProgress,
  isWorkflowJobTerminal,
  isWorkflowProductSelectable,
} from "./workflow-selection";

describe("isWorkflowProductSelectable", () => {
  it("blocks submitted and running products from bulk selection", () => {
    expect(isWorkflowProductSelectable({ latestDraftStatus: "SUBMITTED", latestJobStatus: "SUCCEEDED" })).toBe(false);
    expect(isWorkflowProductSelectable({ latestDraftStatus: null, latestJobStatus: "RUNNING" })).toBe(false);
    expect(isWorkflowProductSelectable({ latestDraftStatus: null, latestJobStatus: "PENDING" })).toBe(false);
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

describe("workflow publishing progress", () => {
  it("calculates progress from completed job steps", () => {
    expect(
      getWorkflowJobProgress({
        status: "RUNNING",
        steps: [
          { status: "SUCCEEDED" },
          { status: "SKIPPED" },
          { status: "FAILED" },
          { status: "RUNNING" },
          { status: "PENDING" },
        ],
      }),
    ).toBe(60);
    expect(getWorkflowJobProgress({ status: "SUCCEEDED", steps: [] })).toBe(100);
    expect(getWorkflowJobProgress({ status: "RUNNING", steps: [] })).toBe(0);
  });

  it("reports terminal jobs and averages product progress", () => {
    expect(isWorkflowJobTerminal({ status: "SUCCEEDED" })).toBe(true);
    expect(isWorkflowJobTerminal({ status: "FAILED" })).toBe(true);
    expect(isWorkflowJobTerminal({ status: "RUNNING" })).toBe(false);
    expect(
      getWorkflowBatchProgress([
        { status: "SUCCEEDED", steps: [{ status: "SUCCEEDED" }, { status: "SUCCEEDED" }] },
        { status: "RUNNING", steps: [{ status: "SUCCEEDED" }, { status: "PENDING" }] },
      ]),
    ).toBe(75);
  });
});
