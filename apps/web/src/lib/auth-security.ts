import { createHash } from "node:crypto";
import { RedisConnection } from "bullmq";
import { env } from "./env";

const WINDOW_SECONDS = 15 * 60;
const ATTEMPTS = 5;
const localAttempts = new Map<string, { count: number; expires: number }>();
let connection: RedisConnection | undefined;

// Increment and expiry must be atomic across processes, including the first attempt.
const LOGIN_ATTEMPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if count > tonumber(ARGV[2]) then return math.max(1, ttl) end
return 0
`;

/** Returns Retry-After seconds, or zero when the login attempt is allowed. */
export async function consumeLoginAttempt(email: string): Promise<number> {
  const key = `auth:login:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
  if (process.env.NODE_ENV !== "production") {
    // ponytail: local-only, single-process budget; production always uses shared Redis.
    const now = Date.now();
    for (const [id, entry] of localAttempts) if (entry.expires <= now) localAttempts.delete(id);
    const previous = localAttempts.get(key);
    if (!previous && localAttempts.size >= 1000) return WINDOW_SECONDS;
    const next = { count: (previous?.count ?? 0) + 1, expires: previous?.expires ?? now + WINDOW_SECONDS * 1000 };
    localAttempts.set(key, next);
    return next.count > ATTEMPTS ? Math.max(1, Math.ceil((next.expires - now) / 1000)) : 0;
  }

  if (!connection) {
    connection = new RedisConnection({
      url: env.redisUrl, connectTimeout: 1000, commandTimeout: 1000,
      maxRetriesPerRequest: 1, retryStrategy: () => null,
    }, { blocking: false, skipVersionCheck: true });
    connection.on("error", () => console.error("Login throttle connection unavailable"));
  }
  const current = connection;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const retryAfter = await Promise.race([
      current.client.then((client) => {
        client.defineCommand("consumeAuthLogin", { numberOfKeys: 1, lua: LOGIN_ATTEMPT });
        return client.runCommand("consumeAuthLogin", [key, WINDOW_SECONDS, ATTEMPTS]);
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 1500); }),
    ]);
    if (typeof retryAfter !== "number" || !Number.isInteger(retryAfter) || retryAfter < 0 || retryAfter > WINDOW_SECONDS) {
      throw new Error("Invalid throttle response");
    }
    return retryAfter;
  } catch {
    if (connection === current) {
      connection = undefined;
      void current.close(true).catch(() => console.error("Login throttle cleanup failed"));
    }
    throw new Error("Login throttle unavailable");
  } finally {
    clearTimeout(timer);
  }
}

/** Bound streamed JSON too: Content-Length is optional and not trusted. */
export async function readAuthBody(req: Request): Promise<unknown> {
  const limit = 16 * 1024;
  if (!req.body || Number(req.headers.get("content-length")) > limit) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
