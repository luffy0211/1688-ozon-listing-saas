import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actions: vi.fn(),
  tenants: vi.fn(),
  runCandidates: vi.fn(),
  runs: vi.fn(),
  execute: vi.fn(),
  recover: vi.fn(),
  message: vi.fn(),
  content: vi.fn(),
}));

vi.mock("@saas/db", () => ({
  AgentRunStatus: { RUNNING: "RUNNING", FAILED: "FAILED" },
  prisma: {
    tenant: { findMany: mocks.tenants },
    agentAction: { findMany: mocks.actions },
    agentRun: { findMany: mocks.runCandidates, updateMany: mocks.runs },
    agentMessage: { findFirst: mocks.message },
  },
}));
vi.mock("../../web/src/lib/agent/content-agent", () => ({ runOzonContentAgent: mocks.content }));
vi.mock("../../web/src/lib/agent/actions", () => ({
  executeApprovedAgentAction: mocks.execute,
  recoverBlockedAgentAction: mocks.recover,
}));

import { processAgentQueueJob, sweepAgentRecovery } from "./agent-recovery";
import { ContentAgentPreparationError } from "../../web/src/lib/agent/content-agent-prepare";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenants.mockResolvedValue([{ id: "tenant-1" }]);
  mocks.actions.mockResolvedValue([]);
  mocks.runCandidates.mockResolvedValue([]);
  mocks.runs.mockResolvedValue({ count: 0 });
  mocks.message.mockResolvedValue(null);
  mocks.content.mockResolvedValue({ runId: "run-1" });
});

describe("agent recovery worker", () => {
  it.each([0, 1])("does not replay an already claimed job (stalled count %s)", async (stalledCounter) => {
    mocks.content.mockRejectedValue(new ContentAgentPreparationError("content_agent_already_dispatched", "claimed"));
    await processAgentQueueJob("run-content-agent", {
      tenantId: "tenant-1", userId: "user-1", sessionId: "session-1", userMessageId: "message-1", runId: "run-1",
    }, { add: vi.fn() }, { stalledCounter });
    if (stalledCounter) expect(mocks.runs).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", error: "content_agent_interrupted" }) }));
    else expect(mocks.runs).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("hands the original run/message IDs to the executor, without making another run", async () => {
    await processAgentQueueJob("run-content-agent", {
      tenantId: "tenant-1", userId: "user-1", sessionId: "session-1", userMessageId: "message-1", runId: "run-1",
    }, { add: vi.fn() });
    expect(mocks.content).toHaveBeenCalledWith({
      tenantId: "tenant-1", userId: "user-1", prompt: "", sessionId: "session-1",
      preparedRun: { sessionId: "session-1", userMessageId: "message-1", runId: "run-1" },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("redispatches unclaimed persisted jobs after Web disappears before enqueue", async () => {
    mocks.runCandidates.mockResolvedValue([{
      id: "run-1", tenantId: "tenant-1", sessionId: "session-1", requestedBy: "user-1",
      startedAt: new Date("2026-09-24T12:00:00Z"), toolCallsJson: { agent: "ozon_content_v1" },
    }]);
    mocks.message.mockResolvedValue({ id: "message-1", metaJson: { dispatch: { state: "pending", queueName: "ozon-agent" } } });
    const queue = { add: vi.fn(), getJob: vi.fn().mockResolvedValue(null) };
    await sweepAgentRecovery(queue, new Date("2026-09-24T12:40:00Z"));
    expect(queue.add).toHaveBeenCalledWith("run-content-agent", {
      tenantId: "tenant-1", userId: "user-1", sessionId: "session-1", userMessageId: "message-1", runId: "run-1",
    }, { jobId: "agent-content-run-1", attempts: 1 });
    expect(mocks.runs).not.toHaveBeenCalled();
    expect(mocks.content).not.toHaveBeenCalled();
  });

  it("does not replay paid tools or drafts from a stalled worker", async () => {
    mocks.runCandidates.mockResolvedValue([{
      id: "run-1", tenantId: "tenant-1", sessionId: "session-1", requestedBy: "user-1",
      startedAt: new Date("2026-09-24T11:00:00Z"),
      toolCallsJson: { agent: "ozon_content_v1", createdActionIds: ["draft-1"], toolCalls: [{ name: "paid-tool" }] },
    }]);
    mocks.message.mockResolvedValue({ id: "message-1", metaJson: { dispatch: { state: "executing", queueName: "ozon-agent" } } });
    const queue = { add: vi.fn() };
    await sweepAgentRecovery(queue, new Date("2026-09-24T12:40:00Z"));
    expect(mocks.runs).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "FAILED", error: "content_agent_interrupted", output: expect.stringContaining("草案"),
    }) }));
    expect(queue.add).not.toHaveBeenCalled();
    expect(mocks.content).not.toHaveBeenCalled();
  });

  it("does not recover diagnosis jobs belonging to another queue namespace", async () => {
    mocks.runCandidates.mockResolvedValue([{
      id: "run-1", tenantId: "tenant-1", sessionId: "session-1", requestedBy: "user-1",
      startedAt: new Date("2026-09-24T11:00:00Z"), toolCallsJson: {},
    }]);
    mocks.message.mockResolvedValue({ id: "message-1", metaJson: { dispatch: { state: "pending", queueName: "ozon-agent-local-review" } } });
    const queue = { add: vi.fn() };
    await sweepAgentRecovery(queue, new Date("2026-09-24T12:40:00Z"));
    expect(queue.add).not.toHaveBeenCalled();
    expect(mocks.runs).not.toHaveBeenCalled();
  });

  it("never performs a global recovery sweep for an isolated local queue", async () => {
    await sweepAgentRecovery({ name: "ozon-agent-local-review", add: vi.fn() });
    expect(mocks.tenants).not.toHaveBeenCalled();
    expect(mocks.actions).not.toHaveBeenCalled();
    expect(mocks.runCandidates).not.toHaveBeenCalled();
  });
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
      where: expect.objectContaining({ id: "run-1", tenantId: "tenant-1", status: "RUNNING" }),
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
