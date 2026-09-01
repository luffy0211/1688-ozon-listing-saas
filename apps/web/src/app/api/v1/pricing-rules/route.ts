import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const rules = await prisma.pricingRule.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
  return ok({ rules });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  if (!body?.name) return fail("validation_error", "缺少规则名称");

  const rule = await prisma.pricingRule.create({
    data: {
      tenantId,
      name: body.name,
      storeId: body.storeId ?? null,
      domesticShippingCny: body.domesticShippingCny ?? 0,
      packagingCny: body.packagingCny ?? 0,
      cnyToRub: body.cnyToRub ?? 12,
      internationalShippingRub: body.internationalShippingRub ?? 0,
      commissionRate: body.commissionRate ?? 0.15,
      targetMarginRate: body.targetMarginRate ?? 0.2,
      isDefault: body.isDefault ?? false,
    },
  });

  return ok({ rule });
}
