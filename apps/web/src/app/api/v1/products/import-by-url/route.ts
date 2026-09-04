import type { NextRequest } from "next/server";
import { fetchProductDetail } from "@saas/1688";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";
import { get1688Cookies } from "@/lib/credential-1688";
import { detailToSourceProductImport } from "@/lib/import-1688";
import { importProduct } from "@/lib/services";

function offerIdFromUrl(url: string): string {
  return (
    url.match(/offer\/(\d+)\.html/)?.[1] ??
    url.match(/[?&]offerId=(\d+)/)?.[1] ??
    ""
  );
}

/** 接口采集单商品详情：offerId/URL → 详情 → 落库 + 标准化。 */
export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  const raw = (body?.url ?? body?.offerId ?? "").trim();
  const offerId = /^\d+$/.test(raw) ? raw : offerIdFromUrl(raw);
  if (!offerId) {
    return fail("validation_error", "请提供商品链接或 offerId");
  }

  const cred = await get1688Cookies(tenantId, body?.credentialId);
  if (!cred) {
    return fail("not_configured", "未配置 1688 登录态，请先扫码登录", [], 409);
  }

  let detail;
  try {
    detail = await fetchProductDetail(cred.cookies, offerId);
  } catch (e) {
    return fail("upstream_error", e instanceof Error ? e.message : "采集商品详情失败", [], 502);
  }
  if (!detail.title && detail.mainImages.length === 0 && detail.properties.length === 0) {
    return fail("upstream_error", "商品详情为空（登录态可能失效）", [], 502);
  }

  const input = detailToSourceProductImport(detail);
  const result = await importProduct(tenantId, input, { skipExisting: true });

  return ok(result);
}
