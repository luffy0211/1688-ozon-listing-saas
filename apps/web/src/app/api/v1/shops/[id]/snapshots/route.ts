import type { NextRequest } from "next/server";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";
import { updateShopSnapshotStatus } from "@/lib/services";

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "ignore" && action !== "restore") {
    return fail("validation_error", "action 必须是 ignore 或 restore");
  }

  const snapshotIds = Array.isArray(body?.snapshotIds)
    ? body.snapshotIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  if (snapshotIds.length === 0) {
    return fail("validation_error", "请先选择新品");
  }

  const result = await updateShopSnapshotStatus(
    tenantId,
    params.id,
    snapshotIds,
    action,
  );

  return ok(result);
}
