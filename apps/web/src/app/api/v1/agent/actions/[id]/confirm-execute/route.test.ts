import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  confirm: vi.fn(),
  execute: vi.fn(),
  enqueue: vi.fn(),
  reject: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/agent/actions", () => ({
  AgentActionRequestError: class AgentActionRequestError extends Error {},
  approveAgentAction: mocks.approve,
  confirmContentDraftAction: mocks.confirm,
  executeApprovedAgentAction: mocks.execute,
  rejectAgentAction: mocks.reject,
}));
vi.mock("@/lib/agent/runtime", () => ({ serializeAgentAction: (value: unknown) => value }));
vi.mock("@/lib/agent/action-queue", () => ({
  enqueueAgentActionExecution: mocks.enqueue,
}));
vi.mock("@/lib/request-session", () => ({ sessionFromRequest: mocks.session }));

import { POST as approvePOST } from "../approve/route";
import { POST as rejectPOST } from "../reject/route";
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ tenantId: "tenant-1", userId: "user-1" });
  mocks.approve.mockResolvedValue({ id: "action-1", type: "CONTENT_DRAFT", status: "APPROVED" });
  mocks.confirm.mockResolvedValue({ id: "action-1", type: "CONTENT_DRAFT", status: "APPROVED" });
  mocks.execute.mockResolvedValue({ id: "action-1", type: "CONTENT_DRAFT", status: "EXECUTED" });
  mocks.enqueue.mockResolvedValue(undefined);
});

describe("POST confirm-execute", () => {
  it("rejects the whole confirmation when one edited field is overlong", async () => {
    const response = await POST(new Request("http://localhost/api/v1/agent/actions/action-1/confirm-execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: "2026-09-24T12:00:00.000Z",
        expectedStoreId: "store-1",
        suggestions: [
          { field: "title", suggestedRu: "有效标题" },
          { field: "description", suggestedRu: "x".repeat(3001) },
        ],
      }),
    }) as never, { params: Promise.resolve({ id: "action-1" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_content_draft_edits" },
    });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("passes the confirmed version, store, and complete edits to the action service", async () => {
    const response = await POST(new Request("http://localhost/api/v1/agent/actions/action-1/confirm-execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: "2026-09-24T12:00:00.000Z",
        expectedStoreId: "store-1",
        suggestions: [
          { field: "title", suggestedRu: "新标题" },
          { field: "description", suggestedRu: "新描述" },
        ],
      }),
    }) as never, { params: Promise.resolve({ id: "action-1" }) });

    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toMatchObject({
      data: { queued: true },
    });
    expect(mocks.confirm).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "action-1",
      expectedVersion: "2026-09-24T12:00:00.000Z",
      expectedStoreId: "store-1",
      edits: [
        { field: "title", suggestedRu: "新标题" },
        { field: "description", suggestedRu: "新描述" },
      ],
    });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith({
      actionId: "action-1",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("keeps an approved action pending when the queue is unavailable", async () => {
    mocks.enqueue.mockRejectedValue(new Error("redis unavailable"));
    const response = await POST(new Request("http://localhost/api/v1/agent/actions/action-1/confirm-execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: "2026-09-24T12:00:00.000Z",
        expectedStoreId: "store-1",
      }),
    }) as never, { params: Promise.resolve({ id: "action-1" }) });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "agent_action_queue_unavailable" },
    });
    expect(mocks.approve).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe("approval route preconditions", () => {
  it.each([
    ["approve", approvePOST, mocks.approve],
    ["reject", rejectPOST, mocks.reject],
  ])("requires version and store for %s", async (_name, handler, actionMock) => {
    const response = await handler(new Request("http://localhost/api/v1/agent/actions/action-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }) as never, { params: Promise.resolve({ id: "action-1" }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "agent_action_precondition_required" },
    });
    expect(actionMock).not.toHaveBeenCalled();
  });
});
