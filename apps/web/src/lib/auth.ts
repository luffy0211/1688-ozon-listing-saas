import { SignJWT, jwtVerify } from "jose";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export type Role = "owner" | "operator" | "admin";

export type SessionPayload = {
  userId: string;
  tenantId: string | null;
  role: Role;
  email: string;
};

const SESSION_COOKIE = "session";
const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dev-insecure-session-secret-change-me",
);

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/** 密码哈希（scrypt，无外部依赖）。 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const candidate = scryptSync(password, salt, expected.length);
  return (
    candidate.length === expected.length &&
    timingSafeEqual(candidate, expected)
  );
}

/** Server Component / Route Handler 中读取当前会话。 */
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

/** 受保护页面：未登录重定向到 /login。 */
export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** 管理员页面：非 admin 重定向到 /dashboard。 */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireUser();
  if (session.role !== "admin") redirect("/dashboard");
  return session;
}

export { SESSION_COOKIE };
