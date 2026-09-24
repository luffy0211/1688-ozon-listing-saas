import type { NextRequest } from "next/server";
import { AgentActionRequestError, rejectAgentAction } from "@/lib/agent/actions";
import { serializeAgentAction } from "@/lib/agent/runtime";
import { fail, forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const body = await req.json().catch(() => ({}));
  const expectedVersion = typeof body.expectedVersion === "string" && body.expectedVersion
    ? body.expectedVersion
    : null;
  const expectedStoreId = body.expectedStoreId === null || typeof body.expectedStoreId === "string"
    ? body.expectedStoreId
    : undefined;
  if (!expectedVersion || expectedStoreId === undefined) {
    return fail("agent_action_precondition_required", "草案版本或店铺信息已过期，请刷新后重试", [], 409);
  }
  try {
    const action = await rejectAgentAction({
      tenantId: session.tenantId,
      userId: session.userId,
      actionId: params.id,
      reason: typeof body.reason === "string" ? body.reason : null,
      expectedVersion,
      expectedStoreId,
    });
    if (!action) return notFound("Agent action not found");

    return ok({ action: serializeAgentAction(action) });
  } catch (error) {
    if (error instanceof AgentActionRequestError) {
      return fail(error.code, error.message, error.details, error.status);
    }
    throw error;
  }
}
