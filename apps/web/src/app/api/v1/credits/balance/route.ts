import type { NextRequest } from "next/server";
import { fail, ok, unauthorized } from "@/lib/api";
import { getTenantCreditBalance } from "@/lib/credits";
import { sessionFromRequest, tenantOf } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = tenantOf(session);
  if (!tenantId) return fail("tenant_required", "当前账号没有租户，无法读取积分余额", [], 403);

  const balance = await getTenantCreditBalance(tenantId);
  return ok(balance);
}
