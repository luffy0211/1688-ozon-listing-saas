import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), password: vi.fn(), sign: vi.fn(), secrets: vi.fn(), throttle: vi.fn() }));
vi.mock("@saas/db", () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock("@/lib/env", () => ({ assertProductionSecrets: mocks.secrets }));
vi.mock("@/lib/auth", () => ({ verifyPassword: mocks.password, signSession: mocks.sign, SESSION_COOKIE: "session" }));
vi.mock("@/lib/auth-security", async (importOriginal) => ({
  ...await importOriginal<object>(), consumeLoginAttempt: mocks.throttle,
}));

import { POST } from "./route";

const input = { email: "user@example.com", password: "password123" };
const request = (body: unknown = input) => new Request("http://localhost/api/v1/auth/login", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}) as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  mocks.user.mockResolvedValue({ id: "user-1", ...input, passwordHash: "hash", role: "owner", tenantId: "tenant-1", name: null });
  mocks.password.mockReturnValue(true);
  mocks.sign.mockResolvedValue("token");
  mocks.throttle.mockResolvedValue(0);
});
afterEach(() => vi.unstubAllEnvs());

describe("login boundary", () => {
  it.each([null, [], { email: 123 }, { ...input, password: 123 }, { ...input, email: "invalid" },
    { ...input, email: `${"a".repeat(255)}@example.com` }, { ...input, password: "p".repeat(1025) },
    { ...input, adminOnly: "true" }])("rejects malformed and unbounded input: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.password).not.toHaveBeenCalled();
  });

  it("bounds the body even without Content-Length", async () => {
    expect((await POST(request({ ...input, ignored: "x".repeat(20_000) }))).status).toBe(400);
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("sets production-only Secure alongside HttpOnly and SameSite", async () => {
    const response = await POST(request({ ...input, email: " User@Example.com " }));
    expect(response.status).toBe(200);
    expect(mocks.throttle).toHaveBeenCalledWith("user@example.com");
    expect(mocks.user).toHaveBeenCalledWith({ where: { email: "user@example.com" } });
    expect(response.headers.get("set-cookie")).toMatch(/; Secure/i);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=lax/i);
    vi.stubEnv("NODE_ENV", "development");
    expect((await POST(request())).headers.get("set-cookie")).not.toMatch(/; Secure/i);
  });

  it("stops throttled logins before password or database work", async () => {
    mocks.throttle.mockResolvedValue(123);
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("123");
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.password).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it.each(["secrets", "throttle", "user", "sign"] as const)("does not leak %s failures", async (source) => {
    const error = new Error("private credential / database / Redis details");
    if (source === "secrets") mocks.secrets.mockImplementation(() => { throw error; });
    else mocks[source].mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(error.message);
    expect(response.headers.has("set-cookie")).toBe(false);
    if (source === "secrets" || source === "throttle") expect(mocks.user).not.toHaveBeenCalled();
  });

  it("returns the same invalid credentials for missing users and incorrect passwords", async () => {
    mocks.user.mockResolvedValue(null);
    const missing = await POST(request());
    mocks.user.mockResolvedValue({ passwordHash: "hash" });
    mocks.password.mockReturnValue(false);
    const incorrect = await POST(request());
    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
    expect(await missing.json()).toEqual(await incorrect.json());
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("still enforces the admin login gate", async () => {
    expect((await POST(request({ ...input, adminOnly: true }))).status).toBe(403);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
