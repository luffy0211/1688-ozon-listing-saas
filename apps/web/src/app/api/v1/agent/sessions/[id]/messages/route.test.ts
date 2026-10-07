import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), model: vi.fn(), serialize: vi.fn() }));
vi.mock("@/lib/request-session", () => ({ sessionFromRequest: mocks.session }));
vi.mock("@/lib/agent/runtime", () => ({ runOzonOpsAgent: mocks.model, serializeAgentResult: mocks.serialize }));

import { POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: "user-1", tenantId: "tenant-1" });
});

describe("retired legacy agent messages", () => {
  it.each(["new", "existing-session"])("returns authenticated 410 for %s without calling the model", async (id) => {
    const req = new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ prompt: "Run paid work" }) });
    const response = await POST(req as never, { params: Promise.resolve({ id }) });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: {
      code: "legacy_agent_retired",
      details: [{ endpoint: "/api/v1/agent/content/sessions/{id}/messages/start" }],
    } });
    expect(response.headers.has("location")).toBe(false);
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.serialize).not.toHaveBeenCalled();
    expect(req.bodyUsed).toBe(false);
  });

  it.each([[null, 401], [{ userId: "admin", tenantId: null }, 403]])("checks authorization before retiring: %j", async (session, status) => {
    mocks.session.mockResolvedValue(session);
    const response = await POST(new Request("http://localhost/api") as never, { params: Promise.resolve({ id: "new" }) });
    expect(response.status).toBe(status);
    expect(mocks.model).not.toHaveBeenCalled();
  });
});
