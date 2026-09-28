import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFind: vi.fn(), sessionCreate: vi.fn(), storeFind: vi.fn(),
  runCreate: vi.fn(), runFind: vi.fn(), runUpdate: vi.fn(),
  messageCreate: vi.fn(), messageFind: vi.fn(), messageUpdate: vi.fn(), debit: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@saas/db", () => {
  const db = {
    $executeRaw: mocks.lock,
    agentSession: { findFirst: mocks.sessionFind, create: mocks.sessionCreate },
    store: { findFirst: mocks.storeFind },
    agentRun: { create: mocks.runCreate, findFirst: mocks.runFind, updateMany: mocks.runUpdate },
    agentMessage: { create: mocks.messageCreate, findFirst: mocks.messageFind, updateMany: mocks.messageUpdate },
  };
  return { prisma: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } };
});
vi.mock("../env", () => ({ env: { openaiAgentModel: "test-model", openaiApiKey: "mock", openaiAgentMock: false } }));
vi.mock("../credits", () => ({ consumeTenantCredits: mocks.debit }));

import { beginContentAgentRun, prepareOzonContentAgentRun } from "./content-agent-prepare";
import { env } from "../env";

const input = { tenantId: "tenant-1", userId: "user-1", prompt: "diagnose", storeId: "store-1" };
const prepared = { sessionId: "session-1", userMessageId: "message-1", runId: "run-1" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.sessionFind.mockResolvedValue({ id: "session-1" });
  mocks.sessionCreate.mockResolvedValue({ id: "session-1" });
  mocks.storeFind.mockResolvedValue({ id: "store-1" });
  mocks.runCreate.mockResolvedValue({ id: "run-1" });
  mocks.messageCreate.mockResolvedValue({ id: "message-1" });
  mocks.runFind.mockResolvedValue({ id: "run-1", sessionId: "session-1", status: "RUNNING", input: "diagnose", requestedBy: "user-1" });
  mocks.messageFind.mockResolvedValue({ id: "message-1", content: "diagnose", metaJson: { agent: "ozon_content_v1", runId: "run-1", storeId: "store-1", dispatch: { state: "pending" } } });
  mocks.messageUpdate.mockResolvedValue({ count: 1 });
  mocks.runUpdate.mockResolvedValue({ count: 1 });
});

it("persists an uncharged run and its original message for dispatch", async () => {
  expect(await prepareOzonContentAgentRun(input)).toEqual({ ...prepared, tenantId: "tenant-1", userId: "user-1" });
  expect(mocks.debit).not.toHaveBeenCalled();
  expect(mocks.messageCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    tenantId: "tenant-1", sessionId: "session-1", role: "USER", metaJson: expect.objectContaining({ runId: "run-1", storeId: "store-1", dispatch: { state: "pending", queueName: "ozon-agent" } }),
  }) }));
});

it("bounds prompt length before persistence", async () => {
  await expect(prepareOzonContentAgentRun({ ...input, prompt: "a".repeat(20_001) })).rejects.toMatchObject({ code: "invalid_prompt" });
  expect(mocks.runCreate).not.toHaveBeenCalled();
  await expect(prepareOzonContentAgentRun({ ...input, prompt: "a".repeat(20_000) })).resolves.toMatchObject(prepared);
});

it("rejects missing model configuration before creating or charging a run", async () => {
  const configured = env.openaiAgentMock;
  env.openaiAgentMock = true;
  try {
    await expect(prepareOzonContentAgentRun(input)).rejects.toMatchObject({ code: "content_agent_model_not_configured" });
    await expect(beginContentAgentRun({ ...input, preparedRun: prepared })).rejects.toMatchObject({ code: "content_agent_model_not_configured" });
    expect(mocks.runCreate).not.toHaveBeenCalled();
    expect(mocks.debit).not.toHaveBeenCalled();
  } finally {
    env.openaiAgentMock = configured;
  }
});

it("locks tenant/session before checking for an already running task and returns its ID", async () => {
  await expect(prepareOzonContentAgentRun({ ...input, sessionId: "session-1" })).rejects.toMatchObject({
    code: "content_agent_run_in_progress", status: 409, details: [{ sessionId: "session-1", runId: "run-1" }],
  });
  expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), "tenant-1", "session-1");
  expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.runFind.mock.invocationCallOrder[0]!);
  expect(mocks.runFind).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant-1", sessionId: "session-1", status: "RUNNING" } }));
  expect(mocks.runCreate).not.toHaveBeenCalled();
  expect(mocks.messageCreate).not.toHaveBeenCalled();
  expect(mocks.debit).not.toHaveBeenCalled();
});

it("uses the persisted prompt and store, not replacement values from a job", async () => {
  const result = await beginContentAgentRun({ ...input, prompt: "tampered", storeId: "other", preparedRun: prepared });
  expect(result).toMatchObject({ prompt: "diagnose", storeId: "store-1" });
  expect(mocks.storeFind).toHaveBeenCalledWith({ where: { id: "store-1", tenantId: "tenant-1" }, select: { id: true } });
});

it("rejects a missing, archived, or other-tenant explicit session instead of creating one", async () => {
  mocks.sessionFind.mockResolvedValue(null);
  await expect(prepareOzonContentAgentRun({ ...input, sessionId: "foreign" })).rejects.toMatchObject({ code: "content_agent_session_not_found" });
  expect(mocks.sessionFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign", tenantId: "tenant-1", status: "OPEN" } }));
  expect(mocks.sessionCreate).not.toHaveBeenCalled();
  expect(mocks.runCreate).not.toHaveBeenCalled();
});

it("rejects another tenant's store before creating any records", async () => {
  mocks.storeFind.mockResolvedValue(null);
  await expect(prepareOzonContentAgentRun(input)).rejects.toMatchObject({ code: "ozon_store_not_found" });
  expect(mocks.storeFind).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant-1", id: "store-1" } }));
  expect(mocks.sessionCreate).not.toHaveBeenCalled();
});

it("claims the same persisted run/message once and uses its debit idempotency key", async () => {
  mocks.messageUpdate.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  const first = await beginContentAgentRun({ ...input, preparedRun: prepared });
  expect(first).toMatchObject({ session: { id: "session-1" }, userMessage: { id: "message-1" }, runRecord: { id: "run-1" } });
  await expect(beginContentAgentRun({ ...input, preparedRun: prepared })).rejects.toMatchObject({ code: "content_agent_already_dispatched" });
  expect(mocks.debit).toHaveBeenCalledTimes(1);
  expect(mocks.debit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", referenceId: "message-1", idempotencyKey: "agent-message:message-1" }));
  expect(mocks.runCreate).not.toHaveBeenCalled();
  expect(mocks.messageCreate).not.toHaveBeenCalled();
});

it("rejects a foreign run and scopes both run and message lookups", async () => {
  mocks.runFind.mockResolvedValue(null);
  await expect(beginContentAgentRun({ ...input, preparedRun: prepared })).rejects.toMatchObject({ code: "content_agent_run_not_found" });
  expect(mocks.runFind).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-1", sessionId: "session-1", requestedBy: "user-1" }) }));
  expect(mocks.debit).not.toHaveBeenCalled();
});

it("never restarts a run already executing even if its progress metadata was replaced", async () => {
  mocks.messageFind.mockResolvedValue({ id: "message-1", metaJson: { agent: "ozon_content_v1", runId: "run-1", storeId: "store-1", dispatch: { state: "executing" } } });
  await expect(beginContentAgentRun({ ...input, preparedRun: prepared })).rejects.toMatchObject({ code: "content_agent_already_dispatched" });
  expect(mocks.debit).not.toHaveBeenCalled();
});

it("fails a claimed run truthfully when its debit fails before model work", async () => {
  mocks.debit.mockRejectedValue(new Error("insufficient credits"));
  await expect(beginContentAgentRun({ ...input, preparedRun: prepared })).rejects.toThrow("insufficient credits");
  expect(mocks.runUpdate).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: "run-1", tenantId: "tenant-1", status: "RUNNING" }),
    data: expect.objectContaining({ status: "FAILED" }),
  }));
});
