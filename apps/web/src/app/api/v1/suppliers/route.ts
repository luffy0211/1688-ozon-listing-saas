import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const suppliers = await prisma.supplier.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { sourceShops: true } } },
  });

  return ok({ suppliers });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  if (!body?.name) return fail("validation_error", "缺少店铺名");

  const supplier = await prisma.supplier.create({
    data: {
      tenantId,
      name: body.name,
      companyName: body.companyName ?? null,
      shopUrl: body.shopUrl ?? null,
      contactName: body.contactName ?? null,
      wangwang: body.wangwang ?? null,
      phone: body.phone ?? null,
      address: body.address ?? null,
      mainCategory: body.mainCategory ?? null,
      cooperationStatus: body.cooperationStatus ?? "UNCONTACTED",
      notes: body.notes ?? null,
      nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null,
    },
  });

  return ok({ supplier });
}
