import type { NextRequest } from "next/server";
import { encryptSecret, maskSecret, prisma } from "@saas/db";
import { fail, forbidden, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

function serializeStore(s: {
  id: string;
  name: string;
  ozonClientId: string;
  ozonApiKey: string;
  ozonSellerId: string | null;
  translationVendor: string;
  isDefault: boolean;
}) {
  return {
    id: s.id,
    name: s.name,
    ozonClientId: maskSecret(s.ozonClientId),
    ozonApiKey: "****",
    ozonSellerId: s.ozonSellerId,
    translationVendor: s.translationVendor,
    isDefault: s.isDefault,
  };
}

function isPositiveInteger(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const stores = await prisma.store.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return ok({ stores: stores.map(serializeStore) });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  const name: string | undefined = body?.name?.trim();
  const clientId: string | undefined = body?.clientId?.trim();
  const apiKey: string | undefined = body?.apiKey?.trim();
  const sellerId: string | null = body?.sellerId?.trim() || null;
  const translationVendor: string | undefined = body?.translationVendor?.trim();

  if (!name || !clientId || !apiKey) {
    return fail("validation_error", "缺少店铺名称 / Client ID / API Key");
  }

  if (!isPositiveInteger(clientId)) {
    return fail("validation_error", "Ozon Client ID 必须是纯数字正整数，请填写 Seller API 页面里的 Client ID");
  }

  const store = await prisma.$transaction(async (tx) => {
    const existing = await tx.store.findFirst({ where: { tenantId, name } });
    const hasStore = existing ? true : (await tx.store.count({ where: { tenantId } })) > 0;
    const isDefault = Boolean(body?.isDefault ?? existing?.isDefault ?? !hasStore);

    const saved = existing
      ? await tx.store.update({
          where: { id: existing.id },
          data: {
            ozonClientId: clientId,
            ozonApiKey: encryptSecret(apiKey),
            ozonSellerId: sellerId ?? existing.ozonSellerId,
            translationVendor: translationVendor || existing.translationVendor,
            isDefault,
          },
        })
      : await tx.store.create({
          data: {
            tenantId,
            name,
            ozonClientId: clientId,
            ozonApiKey: encryptSecret(apiKey),
            ozonSellerId: sellerId,
            translationVendor: translationVendor || "DeepL",
            isDefault,
          },
        });

    if (saved.isDefault) {
      await tx.store.updateMany({
        where: { tenantId, id: { not: saved.id } },
        data: { isDefault: false },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        userId: session.userId,
        action: "store.configure",
        entityType: "store",
        entityId: saved.id,
      },
    });

    return saved;
  });

  return ok({ store: serializeStore(store) });
}
