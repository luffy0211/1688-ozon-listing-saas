import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function Queue() {
    return { add: mocks.add, getJob: mocks.getJob };
  }),
}));

import { enqueueAgentActionExecution, enqueueContentAgentRun, getAgentQueueName } from "./action-queue";

beforeEach(() => vi.resetAllMocks());
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const job = { tenantId: "tenant-1", userId: "user-1", sessionId: "session-1", userMessageId: "message-1", runId: "run-1" };

it("uses a stable diagnosis job ID and does not retry an active duplicate", async () => {
  await enqueueContentAgentRun(job);
  expect(mocks.add).toHaveBeenCalledWith("run-content-agent", job, { jobId: "agent-content-run-1", attempts: 1 });
  mocks.getJob.mockResolvedValue({ isFailed: vi.fn().mockResolvedValue(false) });
  await enqueueContentAgentRun(job);
  expect(mocks.add).toHaveBeenCalledTimes(1);
});

it("reads the isolated queue namespace without changing the default", () => {
  vi.stubEnv("AGENT_QUEUE_NAME", "");
  expect(getAgentQueueName()).toBe("ozon-agent");
  vi.stubEnv("AGENT_QUEUE_NAME", "ozon-agent-local-review");
  expect(getAgentQueueName()).toBe("ozon-agent-local-review");
});

it("bounds an unavailable queue even while its initial connection is pending", async () => {
  vi.useFakeTimers();
  mocks.getJob.mockImplementation(() => new Promise(() => {}));
  const rejected = expect(enqueueContentAgentRun(job)).rejects.toThrow("content_agent_queue_timeout");
  await vi.advanceTimersByTimeAsync(5000);
  await rejected;
});

it("retries a retained failed execution job instead of leaving the action stuck", async () => {
  mocks.getJob.mockResolvedValue({
    isFailed: vi.fn().mockResolvedValue(true),
    retry: mocks.retry,
  });

  await enqueueAgentActionExecution({
    actionId: "action-1",
    tenantId: "tenant-1",
    userId: "user-1",
  });

  expect(mocks.retry).toHaveBeenCalledTimes(1);
  expect(mocks.add).not.toHaveBeenCalled();
});
