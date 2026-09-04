import type { NextRequest } from "next/server";
import { fetchProductDetail, fetchShopName, fetchShopProducts, fetchShopProductsFromPages, resolveMemberId } from "@saas/1688";
import { prisma } from "@saas/db";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";
import { get1688Cookies } from "@/lib/credential-1688";
import { detailToSourceProductImport, selectNewShopProducts, shopProductsToSourceShopImport } from "@/lib/import-1688";
import { importProduct, importShop } from "@/lib/services";

function clampLimit(value: unknown): number {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function mergeProducts<T extends { offerId: string }>(products: T[]): T[] {
  const byOfferId = new Map<string, T>();
  for (const product of products) {
    if (!product.offerId || byOfferId.has(product.offerId)) continue;
    byOfferId.set(product.offerId, product);
  }
  return [...byOfferId.values()];
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  const shopUrl: string | undefined = (body?.shopUrl ?? "").trim();
  const savedShopName: string | undefined = (body?.shopName ?? "").trim();
  const limit = clampLimit(body?.limit);
  if (!shopUrl?.startsWith("http")) {
    return fail("validation_error", "请提供合法的 1688 店铺链接");
  }

  const cred = await get1688Cookies(tenantId, body?.credentialId);
  if (!cred) {
    return fail("not_configured", "未配置 1688 登录态，请先扫码登录", [], 409);
  }

  let memberId: string;
  try {
    memberId = await resolveMemberId(shopUrl, cred.cookies);
  } catch (e) {
    return fail(
      "upstream_error",
      e instanceof Error ? e.message : "解析店铺失败",
      [],
      502,
    );
  }
  if (!memberId) {
    return fail("upstream_error", "无法识别店铺 memberId，请确认店铺链接", [], 422);
  }

  const [detectedShopName, mtopProducts] = await Promise.all([
    fetchShopName(cred.cookies, shopUrl),
    fetchShopProducts(cred.cookies, memberId),
  ]);
  const pageProducts =
    mtopProducts.length < limit * 2
      ? (await fetchShopProductsFromPages(cred.cookies, shopUrl, limit * 2)).map((item) => ({
          ...item,
          memberId,
        }))
      : [];
  const allProducts = mergeProducts([...mtopProducts, ...pageProducts]);
  if (allProducts.length === 0) {
    return fail(
      "upstream_error",
      "店铺商品列表为空，登录态可能失效或店铺暂无商品",
      [],
      502,
    );
  }

  const existingProducts = await prisma.sourceProduct.findMany({
    where: {
      tenantId,
      offerId: { in: allProducts.map((product) => product.offerId) },
    },
    select: { offerId: true },
  });
  const existingOfferIds = new Set(existingProducts.map((product) => product.offerId));
  const products = selectNewShopProducts(allProducts, existingOfferIds, limit);
  const shopName = savedShopName || detectedShopName;
  const input = shopProductsToSourceShopImport(
    shopUrl,
    shopName,
    memberId,
    allProducts,
  );
  const result = await importShop(tenantId, input);
  const poolFailures: Array<{ offerId: string; error: string }> = [];
  const pooledOfferIds: string[] = [];
  let productPoolCreated = 0;
  let detailCollected = 0;

  for (const product of products) {
    try {
      const detail = await fetchProductDetail(cred.cookies, product.offerId, product.title);
      const productInput = detailToSourceProductImport({
        ...detail,
        title: detail.title || product.title,
        shopName: detail.shopName || shopName,
        shopUrl: detail.shopUrl || shopUrl,
        shopId: detail.shopId || memberId,
        mainImages: detail.mainImages.length > 0 ? detail.mainImages : product.images,
        price: detail.price || product.priceText,
        moq: detail.moq || product.moq,
        sales: detail.sales || product.sales,
      });
      const poolResult = await importProduct(tenantId, productInput, { skipExisting: true });
      pooledOfferIds.push(product.offerId);
      if (poolResult.isNew) productPoolCreated++;
      detailCollected++;
    } catch (error) {
      poolFailures.push({
        offerId: product.offerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const productPoolOfferIds = [...new Set([...pooledOfferIds, ...existingOfferIds])];
  if (productPoolOfferIds.length > 0) {
    await prisma.shopProductSnapshot.updateMany({
      where: {
        tenantId,
        shopId: result.shopId,
        offerId: { in: productPoolOfferIds },
      },
      data: { followStatus: "IMPORTED_TO_PRODUCT_POOL" },
    });
  }

  return ok({
    ...result,
    shopName,
    detectedShopName,
    memberId,
    requestedLimit: limit,
    availableCount: allProducts.length,
    collectedCount: products.length,
    mtopCount: mtopProducts.length,
    pageFallbackCount: pageProducts.length,
    productPoolCreated,
    productPoolSkippedExisting: allProducts.filter((product) => existingOfferIds.has(product.offerId)).length,
    productPoolFailed: poolFailures.length,
    detailCollected,
    poolFailures,
    order: "latest_first",
  });
}
