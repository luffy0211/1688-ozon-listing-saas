import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { enqueueAgentActionExecution } from "@/lib/agent/action-queue";
import { serializeAgentAction } from "@/lib/agent/runtime";
import { fail, forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const action = await prisma.agentAction.findFirst({
    where: { id: params.id, tenantId: session.tenantId },
  });
  if (!action) return notFound("Agent action not found");
  if (action.status !== "APPROVED") return ok({ action: serializeAgentAction(action) });

  try {
    await enqueueAgentActionExecution({
      tenantId: session.tenantId,
      userId: session.userId,
      actionId: action.id,
    });
  } catch {
    return fail(
      "agent_action_queue_unavailable",
      "执行队列暂时不可用，草案已保留为已批准，请稍后重试执行",
      [],
      503,
    );
  }

  return ok({ action: serializeAgentAction(action), queued: true });
}
