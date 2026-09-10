import type { NextRequest } from "next/server";
import { fetchProductDetail } from "@saas/1688";
import { prisma } from "@saas/db";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";
import { get1688Cookies } from "@/lib/credential-1688";
import { detailToSourceProductImport } from "@/lib/import-1688";
import { importProduct } from "@/lib/services";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  const snapshotIds: string[] = Array.isArray(body?.snapshotIds)
    ? body.snapshotIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

  if (snapshotIds.length === 0) {
    return ok({ imported: 0, scanned: 0, failures: [] });
  }

  const cred = await get1688Cookies(tenantId, body?.credentialId);
  if (!cred) {
    return fail("not_configured", "未配置 1688 登录态，请先扫码登录", [], 409);
  }

  const snapshots = await prisma.shopProductSnapshot.findMany({
    where: {
      tenantId,
      shopId: params.id,
      id: { in: [...new Set(snapshotIds)] },
      followStatus: "NEW",
    },
    take: 200,
  });

  let imported = 0;
  const failures: Array<{ snapshotId: string; offerId?: string; error: string }> = [];

  for (const snapshot of snapshots) {
    try {
      const detail = await fetchProductDetail(
        cred.cookies,
        snapshot.offerId,
        snapshot.title ?? "",
      );
      const result = await importProduct(
        tenantId,
        detailToSourceProductImport(detail),
        { skipExisting: true },
      );
      await prisma.shopProductSnapshot.update({
        where: { id: snapshot.id },
        data: { followStatus: "IMPORTED_TO_PRODUCT_POOL" },
      });
      if (result.isNew) imported++;
    } catch (error) {
      failures.push({
        snapshotId: snapshot.id,
        offerId: snapshot.offerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const missingIds = snapshotIds.filter(
    (id) => !snapshots.some((snapshot) => snapshot.id === id),
  );
  failures.push(
    ...missingIds.map((id) => ({
      snapshotId: id,
      error: "快照不存在或已不是 NEW 状态",
    })),
  );

  return ok({ imported, scanned: snapshots.length, failures });
}
