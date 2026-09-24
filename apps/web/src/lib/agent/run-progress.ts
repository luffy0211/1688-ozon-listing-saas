import type { AgentExecutionStep, AgentPlanStep } from "./execution-trace";

export type AgentRunProgressStatus = "running" | "succeeded" | "failed";

export type AgentRunProgressSnapshot = {
  tenantId: string;
  sessionId: string;
  runId: string;
  status: AgentRunProgressStatus;
  output: string | null;
  error: string | null;
  plan: AgentPlanStep[];
  executionTrace: AgentExecutionStep[];
  actions: unknown[];
  dataSources: unknown[];
  updatedAt: string;
};

const globalForAgentProgress = globalThis as unknown as {
  ozonAgentRunProgress?: Map<string, AgentRunProgressSnapshot>;
};

const progressStore = globalForAgentProgress.ozonAgentRunProgress ?? new Map<string, AgentRunProgressSnapshot>();
globalForAgentProgress.ozonAgentRunProgress = progressStore;

export function setAgentRunProgress(snapshot: AgentRunProgressSnapshot) {
  progressStore.set(snapshot.runId, snapshot);
}

export function getAgentRunProgress(runId: string) {
  return progressStore.get(runId) ?? null;
}

export function clearAgentRunProgressLater(runId: string) {
  setTimeout(() => {
    progressStore.delete(runId);
  }, 10 * 60 * 1000).unref?.();
}
