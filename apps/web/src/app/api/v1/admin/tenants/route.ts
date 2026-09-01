import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (session.role !== "admin") return forbidden();

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true, sourceProducts: true, listingJobs: true } },
    },
  });

  const failedJobs = await prisma.listingJob.count({
    where: { status: "FAILED" },
  });

  return ok({ tenants, failedJobs });
}
