import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn(), cookies: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: () => false, readFileSync: vi.fn() }));
vi.mock("@saas/db", () => ({ prisma: { user: { findFirst: mocks.user } } }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

const sessionSecret = "test-only-session-key-not-for-deployment-123456";
const encryptionKey = Buffer.alloc(32, 19).toString("base64");
const claims = { userId: "user-1", tenantId: "tenant-1", role: "owner" as const, email: "owner@example.com" };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SESSION_SECRET", sessionSecret);
  vi.stubEnv("APP_ENCRYPTION_KEY", encryptionKey);
  mocks.user.mockResolvedValue({ id: claims.userId, ...claims });
});
afterEach(() => vi.unstubAllEnvs());

async function token(payload: Record<string, unknown> = claims, alg = "HS256", expires = true, secret = sessionSecret) {
  const jwt = new SignJWT(payload).setProtectedHeader({ alg }).setIssuedAt();
  return (expires ? jwt.setExpirationTime("7d") : jwt).sign(new TextEncoder().encode(secret));
}

describe("runtime secret safety", () => {
  it.each([
    ["SESSION_SECRET", undefined],
    ["SESSION_SECRET", ""],
    ["SESSION_SECRET", "short"],
    ["SESSION_SECRET", "dev-insecure-session-secret-change-me"],
    ["SESSION_SECRET", "dev-session-secret-change-before-production"],
    ["APP_ENCRYPTION_KEY", undefined],
    ["APP_ENCRYPTION_KEY", ""],
    ["APP_ENCRYPTION_KEY", "dev-insecure-encryption-key-change-me"],
    ["APP_ENCRYPTION_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="],
    ["APP_ENCRYPTION_KEY", Buffer.from("0123456789abcdef0123456789abcdef").toString("hex")],
    ["APP_ENCRYPTION_KEY", "not-base64"],
  ])("rejects unsafe %s at runtime without breaking module loading", async (name, value) => {
    const signingKey = name === "SESSION_SECRET" ? value || "dev-insecure-session-secret-change-me" : sessionSecret;
    const signed = await token(claims, "HS256", true, signingKey);
    vi.stubEnv(name!, value);
    const auth = await import("./auth");
    await expect(auth.signSession(claims)).rejects.toThrow();
    expect(await auth.verifySession(signed)).toBeNull();
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("loads production env without secrets for build-time route discovery", async () => {
    vi.stubEnv("SESSION_SECRET", undefined);
    vi.stubEnv("APP_ENCRYPTION_KEY", undefined);
    await expect(import("./env")).resolves.toHaveProperty("env");
  });

  it("allows explicit hex encryption keys and development without secrets", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 19).toString("hex"));
    const auth = await import("./auth");
    expect(await auth.verifySession(await auth.signSession(claims))).toEqual(claims);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_SECRET", undefined);
    vi.stubEnv("APP_ENCRYPTION_KEY", undefined);
    await expect(auth.signSession(claims)).resolves.toEqual(expect.any(String));
  });
});

describe("session authorization", () => {
  it("checks current membership once for both page cookies and API bearer tokens", async () => {
    const auth = await import("./auth");
    const signed = await auth.signSession(claims);
    mocks.cookies.mockResolvedValue({ get: () => ({ value: signed }) });
    expect(await auth.getSession()).toEqual(claims);
    expect(mocks.user).toHaveBeenCalledExactlyOnceWith({
      where: { id: claims.userId, tenantId: claims.tenantId },
      select: { id: true, tenantId: true, role: true, email: true },
    });
    mocks.user.mockClear();
    const { sessionFromRequest } = await import("./request-session");
    expect(await sessionFromRequest(new NextRequest("http://localhost/api", {
      headers: { authorization: `Bearer ${signed}` },
    }))).toEqual(claims);
    expect(mocks.user).toHaveBeenCalledTimes(1);
  });

  it.each([null, { role: "operator" }, { tenantId: "another-tenant" }, { email: "changed@example.com" }])(
    "rejects removed users and stale role or membership claims: %j", async (changes) => {
      const auth = await import("./auth");
      mocks.user.mockResolvedValue(changes === null ? null : { ...claims, id: claims.userId, ...changes });
      expect(await auth.verifySession(await token())).toBeNull();
    },
  );

  it("fails closed on a user lookup outage", async () => {
    mocks.user.mockRejectedValue(new Error("private database connection details"));
    const auth = await import("./auth");
    expect(await auth.verifySession(await token())).toBeNull();
  });

  it("does not query users for absent, malformed, oversized, expired or unsupported tokens", async () => {
    const auth = await import("./auth");
    for (const value of [undefined, "invalid", "x".repeat(4097), await token({}, "HS256"),
      await token(claims, "HS384"), await token(claims, "HS256", false),
      await token({ ...claims, exp: 1 }, "HS256", false),
      await token({ ...claims, role: "unexpected" }), await token({ ...claims, tenantId: null })]) {
      expect(await auth.verifySession(value)).toBeNull();
    }
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("accepts platform admins without a tenant but still verifies current role", async () => {
    const admin = { ...claims, tenantId: null, role: "admin" as const };
    mocks.user.mockResolvedValue({ id: admin.userId, ...admin });
    const auth = await import("./auth");
    expect(await auth.verifySession(await auth.signSession(admin))).toEqual(admin);
  });

  it("rejects malformed stored password hashes instead of accepting empty hashes", async () => {
    const { hashPassword, verifyPassword } = await import("./auth");
    for (const value of ["salt:zz", "salt:", "", "salt:00:extra"]) {
      expect(verifyPassword("password123", value)).toBe(false);
    }
    const stored = hashPassword("password123");
    expect(verifyPassword("password123", stored)).toBe(true);
    expect(verifyPassword("wrong-password", stored)).toBe(false);
  });
});
