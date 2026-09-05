import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { PIPELINE_STEPS } from "@saas/core";
import { ok, fail, unauthorized, forbidden, notFound } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";
import { getListingQueue } from "@/lib/queue";

class ProductRunBlocked extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function findActiveJob(tenantId: string, productId: string, storeId: string) {
  return prisma.listingJob.findFirst({
    where: { tenantId, productId, storeId, status: { in: ["PENDING", "RUNNING"] } },
    select: { id: true, status: true },
  });
}

async function ensureJobQueued(jobId: string, autoPublish: boolean) {
  await getListingQueue().add("process-listing", { jobId, autoPublish }, { jobId });
}

async function ensurePendingJobQueued(params: {
  job: { id: string; status: string };
  tenantId: string;
  productId: string;
  autoPublish: boolean;
}) {
  if (params.job.status === "RUNNING") return;
  try {
    await ensureJobQueued(params.job.id, params.autoPublish);
  } catch {
    await prisma.$transaction(async (tx) => {
      const failed = await tx.listingJob.updateMany({
        where: { id: params.job.id, tenantId: params.tenantId, status: "PENDING" },
        data: { status: "FAILED", error: "任务进入处理队列失败，请重试", finishedAt: new Date() },
      });
      if (failed.count) {
        await tx.sourceProduct.updateMany({
          where: { id: params.productId, tenantId: params.tenantId },
          data: { status: "failed" },
        });
      }
    });
    throw new Error("任务进入处理队列失败，请重试");
  }
}

function isSameRunMode(productStatus: string, autoPublish: boolean) {
  return productStatus === (autoPublish ? "publishing" : "draft_generating");
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
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
  const autoPublish = body?.autoPublish === true;

  const store = storeId
    ? await prisma.store.findFirst({ where: { tenantId, id: storeId } })
    : await prisma.store.findFirst({ where: { tenantId, isDefault: true } });
  if (!store) {
    return fail("missing_store", "请先配置 Ozon 店铺");
  }

  const existingJob = await findActiveJob(tenantId, product.id, store.id);
  if (existingJob && isSameRunMode(product.status, autoPublish)) {
    await ensurePendingJobQueued({ job: existingJob, tenantId, productId: product.id, autoPublish });
    return ok({ jobId: existingJob.id, reused: true });
  }

  let jobId: string;
  try {
    const job = await prisma.$transaction(async (tx) => {
      const claimed = await tx.sourceProduct.updateMany({
        where: {
          tenantId,
          id: product.id,
          status: { notIn: ["draft_generating", "publishing"] },
        },
        data: { status: autoPublish ? "publishing" : "draft_generating" },
      });
      if (claimed.count === 0) {
        throw new ProductRunBlocked("listing_job_active", "该商品已有上架任务正在处理");
      }

      const activeJob = await tx.listingJob.findFirst({
        where: {
          tenantId,
          productId: product.id,
          status: { in: ["PENDING", "RUNNING"] },
        },
        select: { id: true },
      });
      if (activeJob) {
        throw new ProductRunBlocked("listing_job_active", "该商品已有上架任务正在处理");
      }

      const submittedDraft = await tx.ozonDraft.findFirst({
        where: {
          tenantId,
          productId: product.id,
          storeId: store.id,
          status: "SUBMITTED",
        },
        select: { id: true },
      });
      if (submittedDraft) {
        throw new ProductRunBlocked("already_submitted", "该商品已提交到 Ozon，禁止重复上架");
      }

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

      return created;
    });
    jobId = job.id;
  } catch (error) {
    if (error instanceof ProductRunBlocked) {
      const [activeJob, currentProduct] = await Promise.all([
        findActiveJob(tenantId, product.id, store.id),
        prisma.sourceProduct.findFirst({ where: { tenantId, id: product.id }, select: { status: true } }),
      ]);
      if (activeJob && currentProduct && isSameRunMode(currentProduct.status, autoPublish)) {
        await ensurePendingJobQueued({ job: activeJob, tenantId, productId: product.id, autoPublish });
        return ok({ jobId: activeJob.id, reused: true });
      }
      return fail(error.code, error.message, [], 409);
    }
    throw error;
  }

  await ensurePendingJobQueued({
    job: { id: jobId, status: "PENDING" },
    tenantId,
    productId: product.id,
    autoPublish,
  });

  return ok({ jobId });
}
