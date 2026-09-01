import type { NextRequest } from "next/server";
import { ok, forbidden, unauthorized } from "@/lib/api";
import { getOzonAnalyticsView } from "@/lib/ozon-analytics";
import { sessionFromRequest } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const storeId = req.nextUrl.searchParams.get("storeId");
  const view = await getOzonAnalyticsView({
    tenantId: session.tenantId,
    storeId,
  });

  return ok(view);
}
