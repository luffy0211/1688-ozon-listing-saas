import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { serializeAgentAction } from "@/lib/agent/runtime";
import { forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const action = await prisma.agentAction.findFirst({
    where: { id: params.id, tenantId: session.tenantId },
  });
  if (!action) return notFound("Agent action not found");

  return ok({ action: serializeAgentAction(action) });
}
