import type { NextRequest } from "next/server";
import {
  approveAgentAction,
  confirmContentDraftAction,
} from "@/lib/agent/actions";
import { enqueueAgentActionExecution } from "@/lib/agent/action-queue";
import { validateContentDraftEdits } from "@/lib/agent/content-draft-edits";
import { serializeAgentAction } from "@/lib/agent/runtime";
import { fail, forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requestError(error: unknown) {
  const value = asRecord(error);
  if (error instanceof Error && typeof value.code === "string") {
    return fail(
      value.code,
      error.message,
      Array.isArray(value.details) ? value.details : [],
      typeof value.status === "number" ? value.status : 409,
    );
  }
  throw error;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const body = asRecord(await req.json().catch(() => ({})));
  const expectedVersion = typeof body.expectedVersion === "string"
    ? body.expectedVersion
    : typeof body.expectedUpdatedAt === "string"
      ? body.expectedUpdatedAt
      : null;
  const hasExpectedStore = Object.hasOwn(body, "expectedStoreId");
  const expectedStoreId = body.expectedStoreId === null || typeof body.expectedStoreId === "string"
    ? body.expectedStoreId
    : undefined;
  if (!expectedVersion || !hasExpectedStore || expectedStoreId === undefined) {
    return fail("agent_action_precondition_required", "草案版本或店铺信息已过期，请刷新后重试", [], 409);
  }

  try {
    let approved;
    if (Object.hasOwn(body, "suggestions")) {
      const validation = validateContentDraftEdits(body.suggestions);
      if (!validation.success) {
        return fail("invalid_content_draft_edits", validation.error.message, [validation.error]);
      }
      approved = await confirmContentDraftAction({
        tenantId: session.tenantId,
        userId: session.userId,
        actionId: params.id,
        expectedVersion,
        expectedStoreId,
        edits: validation.edits,
      });
    } else {
      approved = await approveAgentAction({
        tenantId: session.tenantId,
        userId: session.userId,
        actionId: params.id,
        expectedVersion,
        expectedStoreId,
      });
    }
    if (!approved) return notFound("Agent action not found");
    if (approved.status !== "APPROVED") {
      return ok({ action: serializeAgentAction(approved) });
    }

    try {
      await enqueueAgentActionExecution({
        actionId: params.id,
        tenantId: session.tenantId,
        userId: session.userId,
      });
    } catch {
      return fail(
        "agent_action_queue_unavailable",
        "执行队列暂时不可用，草案已保留为已批准，请稍后重试执行",
        [],
        503,
      );
    }
    return ok({ action: serializeAgentAction(approved), queued: true });
  } catch (error) {
    return requestError(error);
  }
}
