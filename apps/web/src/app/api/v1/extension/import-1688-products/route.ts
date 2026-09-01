import type { NextRequest } from "next/server";
import { validateProductImport, type SourceProductImport } from "@saas/core";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";
import { importProduct } from "@/lib/services";

type ImportFailure = {
  offerId?: string;
  title?: string;
  errors: string[];
};

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  const products = Array.isArray(body?.products)
    ? (body.products as SourceProductImport[])
    : [];
  if (products.length === 0) {
    return fail("validation_error", "没有可导入的商品");
  }

  let created = 0;
  let updated = 0;
  const failures: ImportFailure[] = [];

  for (const product of products.slice(0, 200)) {
    const issues = validateProductImport(product);
    if (issues.length > 0) {
      failures.push({
        offerId: product?.offerId,
        title: product?.title,
        errors: issues.map((issue) => `${issue.field}: ${issue.message}`),
      });
      continue;
    }

    try {
      const result = await importProduct(tenantId, product);
      if (result.isNew) created++;
      else updated++;
    } catch (error) {
      failures.push({
        offerId: product?.offerId,
        title: product?.title,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  return ok({
    received: products.length,
    processed: Math.min(products.length, 200),
    created,
    updated,
    failed: failures.length,
    failures,
  });
}
