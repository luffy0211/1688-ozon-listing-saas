import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const requestSession = await sessionFromRequest(req);
  if (!requestSession) return unauthorized();
  if (!requestSession.tenantId) return forbidden();

  const session = await prisma.agentSession.findFirst({
    where: {
      id: params.id,
      tenantId: requestSession.tenantId,
      status: "OPEN",
      OR: [
        { messages: { some: { metaJson: { path: ["agent"], equals: "ozon_content_v1" } } } },
        { runs: { some: { toolCallsJson: { path: ["agent"], equals: "ozon_content_v1" } } } },
      ],
    },
    select: { id: true },
  });
  if (!session) return notFound("Content agent session not found");

  await prisma.agentSession.update({
    where: { id: session.id },
    data: { status: "ARCHIVED" },
  });

  return ok({ id: session.id, status: "ARCHIVED" });
}
