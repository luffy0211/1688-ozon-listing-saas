import type { NextRequest } from "next/server";
import { prisma, decryptSecret } from "@saas/db";
import { computeRequestHash, OzonClient } from "@saas/ozon";
import { ok, fail, unauthorized, forbidden, notFound } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

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
    include: { store: true },
  });
  if (!draft) return notFound("草稿不存在");
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

  try {
    const client = new OzonClient({
      clientId: draft.store.ozonClientId,
      apiKey: decryptSecret(draft.store.ozonApiKey),
    });
    const response = await client.importProducts(request as never);
    const run = await prisma.publishRun.create({
      data: {
        tenantId,
        draftId: draft.id,
        storeId: draft.storeId,
        requestHash,
        ozonTaskId: String(response.task_id),
        status: "submitted",
        requestJson: request as never,
        responseJson: response as never,
      },
    });
    await prisma.ozonDraft.update({
      where: { id: draft.id },
      data: { status: "SUBMITTED" },
    });
    await prisma.sourceProduct.update({
      where: { id: draft.productId },
      data: { status: "submitted" },
    });

    return ok({ publishRunId: run.id, ozonTaskId: run.ozonTaskId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.publishRun.create({
      data: {
        tenantId,
        draftId: draft.id,
        storeId: draft.storeId,
        requestHash,
        status: "failed",
        requestJson: request as never,
        error: message,
      },
    });
    await prisma.ozonDraft.update({
      where: { id: draft.id },
      data: { status: "FAILED", error: message },
    });
    return fail("ozon_submit_failed", message, [], 502);
  }
}
