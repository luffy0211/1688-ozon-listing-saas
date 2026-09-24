import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { forbidden, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const sessions = await prisma.agentSession.findMany({
    where: { tenantId: session.tenantId, status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    take: 30,
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, role: true, createdAt: true },
      },
      _count: { select: { actions: true, messages: true } },
    },
  });

  return ok({
    sessions: sessions.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      updatedAt: item.updatedAt.toISOString(),
      latestMessage: item.messages[0]
        ? {
            role: item.messages[0].role,
            content: item.messages[0].content,
            createdAt: item.messages[0].createdAt.toISOString(),
          }
        : null,
      counts: item._count,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();
  const body = await req.json().catch(() => ({}));

  const created = await prisma.agentSession.create({
    data: {
      tenantId: session.tenantId,
      createdBy: session.userId,
      title: typeof body.title === "string" ? body.title.slice(0, 120) : "Ozon Agent",
    },
  });

  return ok({
    id: created.id,
    title: created.title,
    status: created.status,
    updatedAt: created.updatedAt.toISOString(),
  });
}
