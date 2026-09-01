import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { fail, forbidden, ok, unauthorized } from "@/lib/api";
import { formatOzonSyncError, syncOzonAnalytics } from "@/lib/ozon-analytics";
import { sessionFromRequest } from "@/lib/request-session";

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const body = await req.json().catch(() => ({}));

  try {
    const view = await syncOzonAnalytics({
      tenantId: session.tenantId,
      userId: session.userId,
      storeId: body?.storeId ?? null,
    });
    return ok(view);
  } catch (error) {
    const formatted = formatOzonSyncError(error);
    await prisma.auditLog
      .create({
        data: {
          tenantId: session.tenantId,
          userId: session.userId,
          action: "ozon.analytics.sync.failed",
          entityType: body?.storeId ? "store" : "ozon_analytics",
          entityId: body?.storeId ?? undefined,
          metaJson: {
            code: formatted.code,
            message: formatted.message,
            ...formatted.meta,
          } as never,
        },
      })
      .catch(() => null);
    return fail(formatted.code, formatted.message, [], formatted.status);
  }
}
