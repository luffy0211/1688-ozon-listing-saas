import { ok } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  const res = ok({});
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
