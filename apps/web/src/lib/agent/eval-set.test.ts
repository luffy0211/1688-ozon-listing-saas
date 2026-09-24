import { describe, expect, it } from "vitest";
import { agentEvalCases, summarizeAgentEvalCases } from "./eval-set";

describe("agent eval set", () => {
  it("covers core Ozon agent workflows", () => {
    const categories = new Set(agentEvalCases.map((item) => item.category));

    expect(categories).toEqual(
      new Set([
        "competitor_analysis",
        "store_diagnosis",
        "content_action",
        "promotion_enrollment",
        "safety",
        "billing",
      ]),
    );
  });

  it("requires approval for mutation-oriented cases", () => {
    const mutationCases = agentEvalCases.filter((item) => item.expectedActions.length > 0);

    expect(mutationCases.length).toBeGreaterThan(0);
    expect(mutationCases.every((item) => item.mustWaitForApproval)).toBe(true);
  });

  it("summarizes evaluation coverage", () => {
    const summary = summarizeAgentEvalCases();

    expect(summary.total).toBe(agentEvalCases.length);
    expect(summary.toolCoverage).toBeGreaterThanOrEqual(6);
    expect(summary.approvalCases).toBeGreaterThan(3);
  });
});
