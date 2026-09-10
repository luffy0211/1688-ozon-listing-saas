import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, unauthorized, forbidden, notFound } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const existing = await prisma.supplier.findFirst({
    where: { tenantId, id: params.id },
  });
  if (!existing) return notFound("供应商不存在");

  const body = await req.json().catch(() => null);
  if (!body) return ok({ supplier: existing });

  const supplier = await prisma.supplier.update({
    where: { id: existing.id },
    data: {
      name: body.name ?? existing.name,
      companyName: body.companyName ?? existing.companyName,
      shopUrl: body.shopUrl ?? existing.shopUrl,
      contactName: body.contactName ?? existing.contactName,
      wangwang: body.wangwang ?? existing.wangwang,
      phone: body.phone ?? existing.phone,
      address: body.address ?? existing.address,
      mainCategory: body.mainCategory ?? existing.mainCategory,
      cooperationStatus: body.cooperationStatus ?? existing.cooperationStatus,
      notes: body.notes ?? existing.notes,
      lastContactedAt: body.lastContactedAt
        ? new Date(body.lastContactedAt)
        : existing.lastContactedAt,
      nextFollowUpAt: body.nextFollowUpAt
        ? new Date(body.nextFollowUpAt)
        : existing.nextFollowUpAt,
    },
  });

  return ok({ supplier });
}