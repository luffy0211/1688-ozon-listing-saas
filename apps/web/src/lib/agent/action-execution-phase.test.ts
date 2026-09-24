import { expect, it } from "vitest";
import { agentActionExecutionPhase } from "./action-execution-phase";

it("separates active verification from blocked work needing a person", () => {
  expect(agentActionExecutionPhase({
    status: "BLOCKED",
    error: "result_pending_verification",
    guardrailJson: {},
  })).toBe("verification_pending");
  expect(agentActionExecutionPhase({
    status: "BLOCKED",
    error: "verification_expired",
    guardrailJson: {},
  })).toBe("manual_required");
});
