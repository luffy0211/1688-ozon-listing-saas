import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), enqueue: vi.fn(), session: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/agent/content-agent-prepare", () => ({
  prepareOzonContentAgentRun: mocks.prepare,
  ContentAgentPreparationError: class extends Error {},
}));
vi.mock("@/lib/agent/action-queue", () => ({ enqueueContentAgentRun: mocks.enqueue }));
vi.mock("@/lib/agent/content-agent", () => ({
  runOzonContentAgent: mocks.run,
  ContentAgentConfigurationError: class extends Error {},
  ContentAgentInputError: class extends Error {},
  contentAgentDataSourcesFromToolCalls: vi.fn(),
  serializeContentAgentAction: vi.fn(),
}));
vi.mock("@/lib/request-session", () => ({ sessionFromRequest: mocks.session }));

import { POST } from "./route";
import { POST as messagesPOST } from "../route";

const job = { tenantId: "tenant-1", userId: "user-1", sessionId: "session-1", userMessageId: "message-1", runId: "run-1" };
function request(body: unknown = { prompt: "diagnose", storeId: "store-1" }) {
  return new Request("http://localhost/api/start", { method: "POST", body: JSON.stringify(body) }) as never;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ tenantId: "tenant-1", userId: "user-1" });
  mocks.prepare.mockResolvedValue(job);
  mocks.enqueue.mockResolvedValue(undefined);
  mocks.run.mockImplementation(async ({ onStarted }) => onStarted({ sessionId: "session-1", runId: "run-1", status: "running" }));
});

it.each([["start", POST], ["messages", messagesPOST]])("%s persists before enqueue and responds without running the model in Web", async (_, handler) => {
  const response = await handler(request(), { params: Promise.resolve({ id: "new" }) });
  expect(response.status).toBe(202);
  expect(mocks.prepare).toHaveBeenCalledWith({ tenantId: "tenant-1", userId: "user-1", prompt: "diagnose", sessionId: null, storeId: "store-1" });
  expect(mocks.enqueue).toHaveBeenCalledWith(job);
  expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.enqueue.mock.invocationCallOrder[0]!);
  expect(mocks.run).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({ data: { sessionId: "session-1", runId: "run-1", status: "running" } });
});

it("returns an actionable queue failure with the persisted IDs, without leaking Redis errors", async () => {
  mocks.enqueue.mockRejectedValue(new Error("redis://secret@private-host"));
  const response = await POST(request(), { params: Promise.resolve({ id: "session-1" }) });
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.error.code).toBe("content_agent_queue_unavailable");
  expect(body.error.details).toEqual([{ sessionId: "session-1", runId: "run-1" }]);
  expect(body.error.message).not.toContain("secret");
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each([null, {}, { prompt: " " }])("rejects invalid input without persisting: %j", async (body) => {
  expect((await POST(request(body), { params: Promise.resolve({ id: "new" }) })).status).toBe(400);
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it("does not trust tenant IDs from the request body", async () => {
  await POST(request({ prompt: "diagnose", tenantId: "other", userId: "other" }), { params: Promise.resolve({ id: "new" }) });
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", userId: "user-1" }));
});
