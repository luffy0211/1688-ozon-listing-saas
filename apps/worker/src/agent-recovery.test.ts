import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actions: vi.fn(),
  tenants: vi.fn(),
  runCandidates: vi.fn(),
  runs: vi.fn(),
  execute: vi.fn(),
  recover: vi.fn(),
}));

vi.mock("@saas/db", () => ({
  AgentRunStatus: { RUNNING: "RUNNING", FAILED: "FAILED" },
  prisma: {
    tenant: { findMany: mocks.tenants },
    agentAction: { findMany: mocks.actions },
    agentRun: { findMany: mocks.runCandidates, updateMany: mocks.runs },
  },
}));
vi.mock("../../web/src/lib/agent/actions", () => ({
  executeApprovedAgentAction: mocks.execute,
  recoverBlockedAgentAction: mocks.recover,
}));

import { processAgentQueueJob, sweepAgentRecovery } from "./agent-recovery";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenants.mockResolvedValue([{ id: "tenant-1" }]);
  mocks.actions.mockResolvedValue([]);
  mocks.runCandidates.mockResolvedValue([]);
  mocks.runs.mockResolvedValue({ count: 0 });
});

describe("agent recovery worker", () => {
  it("queues stale actions once per persisted version and closes abandoned runs", async () => {
    const updatedAt = new Date("2026-09-24T12:00:00.000Z");
    mocks.actions.mockResolvedValue([{
      id: "action-1",
      tenantId: "tenant-1",
      approvedBy: "user-1",
      requestedBy: null,
      updatedAt,
    }]);
    mocks.runCandidates.mockResolvedValue([{
      id: "run-1",
      tenantId: "tenant-1",
      startedAt: new Date("2026-09-24T11:00:00.000Z"),
      toolCallsJson: {
        progressUpdatedAt: "2026-09-24T11:10:00.000Z",
        executionTrace: [{ id: "read", status: "running" }],
      },
    }]);
    const queue = { add: vi.fn().mockResolvedValue(undefined) };

    await sweepAgentRecovery(queue, new Date("2026-09-24T12:40:00.000Z"));

    expect(queue.add).toHaveBeenCalledWith(
      "reconcile-agent-action",
      { actionId: "action-1", tenantId: "tenant-1", userId: "user-1" },
      { jobId: `agent-reconcile-action-1-${updatedAt.getTime()}` },
    );
    expect(mocks.runs).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-1", tenantId: "tenant-1", status: "RUNNING" },
      data: expect.objectContaining({
        status: "FAILED",
        error: "content_agent_interrupted",
      }),
    }));
  });

  it("reconciles unknown results without calling the write executor", async () => {
    const queue = { add: vi.fn() };
    await processAgentQueueJob("reconcile-agent-action", {
      actionId: "action-1",
      tenantId: "tenant-1",
      userId: "user-1",
    }, queue);

    expect(mocks.recover).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("does not fail a long run that still has recent persisted progress", async () => {
    mocks.runCandidates.mockResolvedValue([{
      id: "run-live",
      tenantId: "tenant-1",
      startedAt: new Date("2026-09-24T11:00:00.000Z"),
      toolCallsJson: { progressUpdatedAt: "2026-09-24T12:35:00.000Z" },
    }]);
    const queue = { add: vi.fn() };

    await sweepAgentRecovery(queue, new Date("2026-09-24T12:40:00.000Z"));

    expect(mocks.runs).not.toHaveBeenCalled();
  });
});
