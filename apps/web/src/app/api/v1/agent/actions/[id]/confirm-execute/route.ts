import type { NextRequest } from "next/server";
import { approveAgentAction, executeApprovedAgentAction } from "@/lib/agent/actions";
import { serializeAgentAction } from "@/lib/agent/runtime";
import { forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const approved = await approveAgentAction({
    tenantId: session.tenantId,
    userId: session.userId,
    actionId: params.id,
  });
  if (!approved) return notFound("Agent action not found");

  const executed = await executeApprovedAgentAction({
    tenantId: session.tenantId,
    userId: session.userId,
    actionId: params.id,
  });
  if (!executed) return notFound("Agent action not found");

  return ok({ action: serializeAgentAction(executed) });
}
