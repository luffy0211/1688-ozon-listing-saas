import type { NextRequest } from "next/server";
import { rejectAgentAction } from "@/lib/agent/actions";
import { serializeAgentAction } from "@/lib/agent/runtime";
import { forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const body = await req.json().catch(() => ({}));
  const action = await rejectAgentAction({
    tenantId: session.tenantId,
    userId: session.userId,
    actionId: params.id,
    reason: typeof body.reason === "string" ? body.reason : null,
  });
  if (!action) return notFound("Agent action not found");

  return ok({ action: serializeAgentAction(action) });
}
