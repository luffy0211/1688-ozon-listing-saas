import type { NextRequest } from "next/server";
import { fail, forbidden, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";
import {
  CreditAdjustmentError,
  adjustTenantCredits,
  getAdminCreditOverview,
  normalizeCreditAdjustment,
} from "@/lib/credits";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (session.role !== "admin") return forbidden();

  const overview = await getAdminCreditOverview();
  return ok(overview);
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (session.role !== "admin") return forbidden();

  try {
    const input = normalizeCreditAdjustment(await req.json());
    const result = await adjustTenantCredits({
      ...input,
      createdBy: session.userId,
      referenceType: "admin_manual_adjustment",
    });
    return ok(result, 201);
  } catch (error) {
    if (error instanceof CreditAdjustmentError) {
      return fail(error.code, error.message, [], error.status);
    }
    console.error("admin credit adjustment failed", error);
    return fail("credit_adjustment_failed", "积分调整失败", [], 500);
  }
}
