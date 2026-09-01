import type { NextRequest } from "next/server";
import { createQrCode } from "@saas/1688";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  try {
    const qr = await createQrCode();
    return ok({
      lgToken: qr.lgToken,
      adToken: qr.adToken,
      qrCookies: qr.qrCookies,
      url: qr.url.startsWith("//") ? `https:${qr.url}` : qr.url,
      createdAt: Date.now(),
    });
  } catch (e) {
    return fail(
      "upstream_error",
      e instanceof Error ? e.message : "生成二维码失败",
      [],
      502,
    );
  }
}
