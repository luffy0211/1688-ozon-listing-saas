import type {
  ProductDetail,
  ShopProductItem,
} from "@saas/1688";
import type { SourceProductImport, SourceShopImport } from "@saas/core";

function num(v: string | number | undefined): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function selectNewShopProducts<T extends { offerId: string }>(
  products: T[],
  existingOfferIds: Set<string>,
  limit: number,
): T[] {
  return products
    .filter((product) => !existingOfferIds.has(product.offerId))
    .slice(0, limit);
}

/** 店铺商品列表 → SourceShopImport 合同（复用 importShop 落库 + 新品判定）。 */
export function shopProductsToSourceShopImport(
  shopUrl: string,
  shopName: string,
  shopId: string,
  products: ShopProductItem[],
): SourceShopImport {
  return {
    source: "1688",
    shopUrl,
    shopId: shopId || undefined,
    shopName,
    capturedAt: new Date().toISOString(),
    products: products.map((p) => ({
      offerId: p.offerId,
      title: p.title,
      url: p.url,
      imageUrl: p.images[0],
      priceText: p.priceText || undefined,
      soldText: p.sales || undefined,
    })),
  };
}

/** 商品详情 → SourceProductImport 合同（复用 importProduct 落库 + 标准化）。 */
export function shopProductItemToSourceProductImport(
  shopUrl: string,
  shopName: string,
  shopId: string,
  product: ShopProductItem,
): SourceProductImport {
  const price = num(product.priceText);
  const moq = num(product.moq) || 1;

  return {
    source: "1688",
    sourceUrl: product.url,
    offerId: product.offerId,
    capturedAt: new Date().toISOString(),
    shop: {
      shopId: shopId || product.memberId || undefined,
      shopName: shopName || "未知店铺",
      shopUrl,
    },
    title: product.title || `1688 商品 ${product.offerId}`,
    categoryPath: [],
    priceTiers: price > 0 ? [{ minQuantity: moq, priceCny: price }] : [],
    properties: [],
    skus: [],
    mainImages: product.images,
    detailImages: [],
    logistics: { minOrderQuantity: moq },
  };
}

export function detailToSourceProductImport(
  detail: ProductDetail,
): SourceProductImport {
  const moq = num(detail.moq);
  const price = num(detail.price);

  return {
    source: "1688",
    sourceUrl: detail.sourceUrl,
    offerId: detail.offerId,
    capturedAt: new Date().toISOString(),
    shop: {
      shopId: detail.shopId || undefined,
      shopName: detail.shopName || "未知店铺",
      shopUrl: detail.shopUrl || undefined,
    },
    title: detail.title,
    categoryPath:
      detail.categoryPath && detail.categoryPath.length > 0
        ? detail.categoryPath
        : detail.leafCategoryId != null
          ? [String(detail.leafCategoryId)]
          : [],
    priceTiers: price > 0 ? [{ minQuantity: moq || 1, priceCny: price }] : [],
    properties: detail.properties,
    skus: detail.skus.map((s) => ({
      skuId: s.skuId,
      name: s.name,
      attributes: s.attributes,
      priceCny: s.priceCny,
      stockText: s.stockText,
      imageUrl: s.imageUrl,
    })),
    mainImages: detail.mainImages,
    detailImages: detail.detailImages,
    logistics: detail.minOrderQuantity
      ? { minOrderQuantity: detail.minOrderQuantity }
      : undefined,
  };
}
