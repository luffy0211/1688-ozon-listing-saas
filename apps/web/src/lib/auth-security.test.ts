import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn(), define: vi.fn(), close: vi.fn(), on: vi.fn() }));
vi.mock("bullmq", () => ({ RedisConnection: mocks.create }));
vi.mock("./env", () => ({ env: { redisUrl: "redis://mock.invalid:6379" } }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  mocks.run.mockResolvedValue(0);
  mocks.close.mockResolvedValue(undefined);
  mocks.create.mockImplementation(function () {
    return { client: Promise.resolve({ runCommand: mocks.run, defineCommand: mocks.define }), on: mocks.on, close: mocks.close };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("login throttle", () => {
  it("is lazy and uses one atomic, expiring Redis operation per normalized account", async () => {
    const { consumeLoginAttempt } = await import("./auth-security");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(await consumeLoginAttempt(" User@Example.com ")).toBe(0);
    mocks.run.mockResolvedValue(87);
    expect(await consumeLoginAttempt("user@example.com")).toBe(87);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      url: "redis://mock.invalid:6379", maxRetriesPerRequest: 1, connectTimeout: 1000, commandTimeout: 1000,
    }), { blocking: false, skipVersionCheck: true });
    const [name, { lua: script, numberOfKeys: keyCount }] = mocks.define.mock.calls[0]!;
    const [command, [key, window, limit]] = mocks.run.mock.calls[0]!;
    expect(command).toBe(name);
    expect(script).toContain("INCR");
    expect(script).toContain("EXPIRE");
    expect(script).toContain("TTL");
    expect([keyCount, window, limit]).toEqual([1, 900, 5]);
    expect(key).toMatch(/^auth:login:[0-9a-f]{64}$/);
    expect(mocks.run.mock.calls[1]![1][0]).toBe(key);
  });

  it("fails closed on Redis outage and reconnects on the next attempt", async () => {
    const { consumeLoginAttempt } = await import("./auth-security");
    mocks.run.mockRejectedValueOnce(new Error("private Redis credentials"));
    await expect(consumeLoginAttempt("user@example.com")).rejects.toThrow("Login throttle unavailable");
    expect(mocks.close).toHaveBeenCalledWith(true);
    expect(await consumeLoginAttempt("user@example.com")).toBe(0);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("bounds waits on a hung Redis initialization", async () => {
    vi.useFakeTimers();
    mocks.create.mockImplementation(function () {
      return { client: new Promise(() => {}), on: mocks.on, close: mocks.close };
    });
    const { consumeLoginAttempt } = await import("./auth-security");
    const check = expect(consumeLoginAttempt("user@example.com")).rejects.toThrow("Login throttle unavailable");
    await vi.advanceTimersByTimeAsync(1500);
    await check;
    expect(mocks.close).toHaveBeenCalledWith(true);
  });

  it.each([undefined, "0", -1, NaN, 901])("rejects malformed Redis responses: %s", async (value) => {
    mocks.run.mockResolvedValue(value);
    const { consumeLoginAttempt } = await import("./auth-security");
    await expect(consumeLoginAttempt("user@example.com")).rejects.toThrow("Login throttle unavailable");
  });

  it("keeps local development bounded without needing Redis", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.useFakeTimers();
    const { consumeLoginAttempt } = await import("./auth-security");
    for (let i = 0; i < 5; i++) expect(await consumeLoginAttempt("user@example.com")).toBe(0);
    expect(await consumeLoginAttempt(" USER@example.com ")).toBe(900);
    expect(await consumeLoginAttempt("other@example.com")).toBe(0);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(await consumeLoginAttempt("user@example.com")).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("bounded auth JSON", () => {
  it("rejects malformed JSON and advertised oversized requests", async () => {
    const { readAuthBody } = await import("./auth-security");
    expect(await readAuthBody(new Request("http://localhost", { method: "POST", body: "{" }))).toBeNull();
    const request = new Request("http://localhost", { method: "POST", headers: { "content-length": "20000" }, body: "{}" });
    expect(await readAuthBody(request)).toBeNull();
    expect(request.bodyUsed).toBe(false);
  });
});
