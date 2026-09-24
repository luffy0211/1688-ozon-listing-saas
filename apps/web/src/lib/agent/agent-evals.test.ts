import { describe, expect, it } from "vitest";

import { AGENT_EVAL_CASES, evaluateAgentRoutingCase } from "./agent-evals";

describe("agent eval cases", () => {
  it("keeps eval case ids unique", () => {
    const ids = AGENT_EVAL_CASES.map((testCase) => testCase.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("plain-chat-no-tool");
    expect(ids).toContain("listing-plan-requires-planner");
  });

  it("passes the deterministic routing checks", () => {
    const results = AGENT_EVAL_CASES.map((testCase) => evaluateAgentRoutingCase(testCase));

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "own-store-count-requires-snapshot", passed: true }),
        expect.objectContaining({ id: "competitor-analysis-requires-evidence", passed: true }),
        expect.objectContaining({ id: "promotion-policy-requires-policy-tool", passed: true }),
        expect.objectContaining({ id: "listing-plan-requires-planner", passed: true }),
      ]),
    );
    expect(results.filter((result) => !result.passed)).toEqual([]);
  });
});
