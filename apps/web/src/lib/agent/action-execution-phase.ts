export type AgentActionExecutionPhase =
  | "executing"
  | "verification_pending"
  | "manual_required"
  | "finished";

export function agentActionExecutionPhase(action: {
  status: string;
  error: string | null;
  guardrailJson: unknown;
}): AgentActionExecutionPhase | null {
  if (["EXECUTED", "FAILED", "REJECTED"].includes(action.status)) return "finished";
  const guardrail = action.guardrailJson && typeof action.guardrailJson === "object"
    ? action.guardrailJson as Record<string, unknown>
    : {};
  const execution = guardrail.execution && typeof guardrail.execution === "object"
    ? guardrail.execution as Record<string, unknown>
    : {};
  const saved = execution.phase;
  if (
    saved === "executing"
    || saved === "verification_pending"
    || saved === "manual_required"
    || saved === "finished"
  ) {
    return saved;
  }
  if (action.status !== "BLOCKED") return null;
  if (action.error === "execution_in_progress") return "executing";
  if (action.error === "result_pending_verification") return "verification_pending";
  return "manual_required";
}
