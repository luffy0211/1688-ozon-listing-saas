import { SignJWT, jwtVerify } from "jose";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@saas/db";
import { z } from "zod";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { assertProductionSecrets, env } from "./env";

export type Role = "owner" | "operator" | "admin";

export type SessionPayload = {
  userId: string;
  tenantId: string | null;
  role: Role;
  email: string;
};

const SESSION_COOKIE = "session";
const sessionSchema = z.object({
  userId: z.string().min(1).max(128),
  tenantId: z.string().min(1).max(128).nullable(),
  role: z.enum(["owner", "operator", "admin"]),
  email: z.string().max(254).email(),
}).refine((session) => session.role === "admin" || session.tenantId !== null);

export async function signSession(payload: SessionPayload): Promise<string> {
  assertProductionSecrets();
  return new SignJWT(sessionSchema.parse(payload))
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(env.sessionSecret));
}

export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token || token.length > 4096) return null;
  try {
    assertProductionSecrets();
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.sessionSecret), {
      algorithms: ["HS256"], requiredClaims: ["exp", "iat"], maxTokenAge: "7d",
    });
    const parsed = sessionSchema.safeParse(payload);
    if (!parsed.success) return null;
    const session = parsed.data;
    // No disable flag or revocation store exists: re-check current membership and role.
    const user = await prisma.user.findFirst({
      where: { id: session.userId, tenantId: session.tenantId },
      select: { id: true, tenantId: true, role: true, email: true },
    });
    if (!user || user.tenantId !== session.tenantId || user.role !== session.role || user.email !== session.email) return null;
    return session;
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
  if (!/^[0-9a-f]{32}:[0-9a-f]{128}$/i.test(stored)) return false;
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
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

/** 受保护页面：未登录重定向到 /login。 */
export async function requireUser(loginPath = "/login"): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect(loginPath);
  return session;
}

/** 管理员页面：非 admin 重定向到 /dashboard。 */
export async function requireAdmin(loginPath = "/login"): Promise<SessionPayload> {
  const session = await requireUser(loginPath);
  if (session.role !== "admin") redirect(loginPath === "/login" ? "/dashboard" : loginPath);
  return session;
}

export { SESSION_COOKIE };
