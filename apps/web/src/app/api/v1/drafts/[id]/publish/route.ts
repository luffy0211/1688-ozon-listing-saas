import type { NextRequest } from "next/server";
import { prisma, decryptSecret } from "@saas/db";
import { checkSubmitGuards, computeRequestHash, mockImportProducts, OzonClient, OzonApiError } from "@saas/ozon";
import { ok, fail, unauthorized, forbidden, notFound } from "@/lib/api";
import { consumeTenantCredits, CreditAdjustmentError, refundTenantCredits } from "@/lib/credits";
import { sessionFromRequest } from "@/lib/request-session";
import { claimPublishRun } from "@/lib/agent/publish-claim";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const draft = await prisma.ozonDraft.findFirst({
    where: { tenantId, id: params.id },
    include: { product: { include: { productAssets: true } }, store: true },
  });
  if (!draft) return notFound("草稿不存在");
  if (draft.store.tenantId !== tenantId || draft.product.tenantId !== tenantId) return forbidden();
  if (draft.status !== "COMPILED") {
    return fail("invalid_state", "只有已生成待确认的草稿可以上架", [], 409);
  }

  const request = asRecord(draft.payloadJson);
  if (!Array.isArray(request.items) || request.items.length === 0) {
    return fail("invalid_payload", "草稿 payload 为空，无法提交", [], 422);
  }
  if (!draft.store.ozonClientId || !draft.store.ozonApiKey) {
    return fail("missing_store", "请先配置 Ozon 店铺密钥", [], 409);
  }

  const requestHash = computeRequestHash(draft.storeId, request);
  const duplicate = await prisma.publishRun.findUnique({
    where: {
      storeId_requestHash: { storeId: draft.storeId, requestHash },
    },
  });
  if (duplicate) {
    return fail("duplicate_submission", "同一店铺同一草稿已提交过，禁止重复上架", [], 409);
  }

  const xiangjiCredentialCount = await prisma.xiangjiCredential.count({ where: { tenantId } });
  const hasPrice = request.items.every((item) => {
    const price = asRecord(item).price;
    return Number(price) > 0;
  });
  const guard = checkSubmitGuards({
    hasOzonCredentials: Boolean(draft.store.ozonClientId && draft.store.ozonApiKey),
    hasXiangjiKey: xiangjiCredentialCount > 0,
    hasMainImage: draft.product.productAssets.some((asset) => asset.kind === "main_image" || asset.kind === "sku_image"),
    hasDetailImage: draft.product.productAssets.some((asset) => asset.kind === "detail_image"),
    hasPrice,
    payload: request,
    duplicateSubmission: false,
  });
  if (!guard.ok) {
    return fail("submit_guard_failed", guard.failures.join("; "), guard.failures, 422);
  }
  if (request.items.length !== 1 || asRecord(request.items[0]).offer_id !== draft.product.offerId) {
    return fail("product_identity_mismatch", "草稿中的商品与当前商品不一致，请重新生成", [], 422);
  }

  const client = process.env.ENABLE_REAL_OZON_SUBMIT === "true"
    ? new OzonClient({ clientId: draft.store.ozonClientId, apiKey: decryptSecret(draft.store.ozonApiKey) })
    : null;
  let run;
  try {
    run = await claimPublishRun({ tenantId, draftId: draft.id, storeId: draft.storeId, requestHash, request });
  } catch (error) {
    if (error instanceof Error && error.message === "duplicate_submission") {
      return fail("duplicate_submission", "该商品正在提交或已提交，请查看上架记录", [], 409);
    }
    throw error;
  }

  const creditReference = {
    referenceType: "ozon_draft_publish",
    referenceId: draft.id,
    idempotencyKey: `listing-publish:${draft.storeId}:${requestHash}`,
  };
  try {
    await consumeTenantCredits({
      tenantId,
      feature: "listing_publish",
      createdBy: session.userId,
      ...creditReference,
    });
  } catch (error) {
    // No external request has started, so releasing this reservation is safe.
    await prisma.publishRun.deleteMany({ where: { id: run.id, tenantId, status: "submitting" } });
    if (error instanceof CreditAdjustmentError) {
      return fail(error.code, error.message, [], error.status);
    }
    throw error;
  }

  let response: { task_id: number | string } | undefined;
  try {
    response = client ? await client.importProducts(request as never) : mockImportProducts(request as never);
    await prisma.publishRun.update({
      where: { id: run.id, tenantId },
      data: {
        ozonTaskId: String(response.task_id),
        status: "submitted",
        responseJson: response as never,
      },
    });
    await prisma.ozonDraft.update({
      where: { id: draft.id, tenantId },
      data: { status: "SUBMITTED" },
    });
    await prisma.sourceProduct.update({
      where: { id: draft.productId, tenantId },
      data: { status: "submitted" },
    });

    return ok({ publishRunId: run.id, ozonTaskId: String(response.task_id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rejected = !response && error instanceof OzonApiError
      && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
    if (!rejected) {
      await prisma.publishRun.update({
        where: { id: run.id, tenantId },
        data: { status: "pending_verification", error: message, ...(response ? { ozonTaskId: String(response.task_id) } : {}) },
      });
      return ok({ publishRunId: run.id, status: "pending_verification", message: "提交结果待核实，请勿重复上架" }, 202);
    }
    await refundTenantCredits({
      tenantId,
      feature: "listing_publish",
      createdBy: session.userId,
      ...creditReference,
      idempotencyKey: `refund:${creditReference.idempotencyKey}`,
    }).catch(() => null);
    await prisma.publishRun.update({
      where: { id: run.id, tenantId },
      data: {
        status: "failed",
        error: message,
      },
    });
    await prisma.ozonDraft.update({
      where: { id: draft.id, tenantId },
      data: { status: "FAILED", error: message },
    });
    return fail("ozon_submit_failed", message, [], 502);
  }
}
