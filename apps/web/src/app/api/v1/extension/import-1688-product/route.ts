import type { NextRequest } from "next/server";
import { validateProductImport, type SourceProductImport } from "@saas/core";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";
import { importProduct } from "@/lib/services";

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const input = (await req.json().catch(() => null)) as SourceProductImport | null;
  if (!input) return fail("validation_error", "请求体非法");

  const issues = validateProductImport(input);
  if (issues.length > 0) {
    return fail("validation_error", "采集数据校验失败", issues);
  }

  const result = await importProduct(tenantId, input, { skipExisting: true });
  return ok(result);
}
