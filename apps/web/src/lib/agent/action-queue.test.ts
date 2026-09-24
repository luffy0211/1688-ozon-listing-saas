import { expect, it, vi } from "vitest";

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

import { enqueueAgentActionExecution } from "./action-queue";

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
