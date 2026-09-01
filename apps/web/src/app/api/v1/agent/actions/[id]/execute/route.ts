import type { NextRequest } from "next/server";
import { executeApprovedAgentAction } from "@/lib/agent/actions";
import { serializeAgentAction } from "@/lib/agent/runtime";
import { forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const action = await executeApprovedAgentAction({
    tenantId: session.tenantId,
    userId: session.userId,
    actionId: params.id,
  });
  if (!action) return notFound("Agent action not found");

  return ok({ action: serializeAgentAction(action) });
}
