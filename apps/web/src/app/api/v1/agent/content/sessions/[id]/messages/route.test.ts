import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentSessionFindFirst: vi.fn(),
  agentMessageFindMany: vi.fn(),
  agentRunFindMany: vi.fn(),
  agentRunFindFirst: vi.fn(),
  agentActionFindMany: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@saas/db", () => ({
  prisma: {
    agentSession: { findFirst: mocks.agentSessionFindFirst },
    agentMessage: { findMany: mocks.agentMessageFindMany },
    agentRun: {
      findMany: mocks.agentRunFindMany,
      findFirst: mocks.agentRunFindFirst,
    },
    agentAction: { findMany: mocks.agentActionFindMany },
  },
}));
vi.mock("@/lib/agent/content-agent", () => ({
  contentAgentDataSourcesFromToolCalls: () => [],
  serializeContentAgentAction: (value: unknown) => value,
}));
vi.mock("@/lib/request-session", () => ({ sessionFromRequest: mocks.session }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ tenantId: "tenant-1", userId: "user-1" });
  mocks.agentSessionFindFirst.mockResolvedValue({
    id: "session-1",
    title: "诊断",
    status: "OPEN",
    updatedAt: new Date("2026-09-24T10:00:00.000Z"),
  });
  mocks.agentMessageFindMany.mockResolvedValue([{
    id: "user-message",
    role: "USER",
    content: "诊断店铺",
    metaJson: { agent: "ozon_content_v1" },
    createdAt: new Date("2026-09-24T10:00:00.000Z"),
  }]);
  mocks.agentRunFindMany.mockResolvedValue([]);
  mocks.agentActionFindMany.mockResolvedValue([]);
});

describe("GET content agent history", () => {
  it("returns an unfinished run even before an assistant message exists", async () => {
    mocks.agentRunFindFirst.mockResolvedValue({
      id: "run-1",
      input: "诊断店铺",
      output: null,
      error: null,
      status: "RUNNING",
      toolCallsJson: {
        agent: "ozon_content_v1",
        plan: [{ id: "plan", status: "succeeded" }],
        executionTrace: [{ id: "read", status: "running" }],
      },
      createdAt: new Date("2026-09-24T10:00:01.000Z"),
    });

    const response = await GET(new Request("http://localhost/api/v1/agent/content/sessions/session-1/messages") as never, {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        activeRun: {
          runId: "run-1",
          status: "running",
          requestPrompt: "诊断店铺",
          executionTrace: [{ id: "read", status: "running" }],
        },
      },
    });
    expect(mocks.agentRunFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: "tenant-1", sessionId: "session-1" }),
    }));
  });
});
