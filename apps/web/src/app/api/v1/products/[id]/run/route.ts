import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { PIPELINE_STEPS } from "@saas/core";
import { ok, fail, unauthorized, forbidden, notFound } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";
import { getListingQueue } from "@/lib/queue";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const product = await prisma.sourceProduct.findFirst({
    where: { tenantId, id: params.id },
  });
  if (!product) return notFound("商品不存在");

  const body = await req.json().catch(() => null);
  const storeId: string | undefined = body?.storeId;

  const store = storeId
    ? await prisma.store.findFirst({ where: { tenantId, id: storeId } })
    : await prisma.store.findFirst({ where: { tenantId, isDefault: true } });
  if (!store) {
    return fail("missing_store", "请先配置 Ozon 店铺");
  }

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.listingJob.create({
      data: {
        tenantId,
        productId: product.id,
        storeId: store.id,
        status: "PENDING",
      },
    });

    await tx.jobStep.createMany({
      data: PIPELINE_STEPS.map((name, i) => ({
        tenantId,
        jobId: created.id,
        stepName: name,
        stepIndex: i,
        status: "PENDING",
      })),
    });

    await tx.sourceProduct.update({
      where: { id: product.id },
      data: { status: "draft_generating" },
    });

    return created;
  });

  await getListingQueue().add(
    "process-listing",
    { jobId: job.id },
    { jobId: job.id },
  );

  return ok({ jobId: job.id });
}
