import { prisma } from "@saas/db";
import {
  diffShopProducts,
  normalizeProduct,
  snapshotHash,
  type SourceProductImport,
  type SourceShopImport,
} from "@saas/core";

function parseDate(value?: string): Date {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function isUsableProductImageUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const lower = url.split("?")[0]!.toLowerCase();
  if (/\.(gif|mp4|webm|mov|m4v|avi)$/.test(lower)) return false;
  return !/\/video\//i.test(url);
}

function cleanProductMedia(input: SourceProductImport): SourceProductImport {
  return {
    ...input,
    mainImages: input.mainImages.filter(isUsableProductImageUrl),
    detailImages: input.detailImages.filter(isUsableProductImageUrl),
    skus: input.skus.map((sku) => ({
      ...sku,
      imageUrl: isUsableProductImageUrl(sku.imageUrl) ? sku.imageUrl : undefined,
    })),
  };
}

function sourceProductAssets(
  tenantId: string,
  productId: string,
  input: SourceProductImport,
) {
  return [
    ...input.mainImages.filter(isUsableProductImageUrl).map((url, i) => ({
      tenantId,
      productId,
      kind: "main_image",
      sourceUrl: url,
      sortOrder: i,
    })),
    ...input.detailImages.filter(isUsableProductImageUrl).map((url, i) => ({
      tenantId,
      productId,
      kind: "detail_image",
      sourceUrl: url,
      sortOrder: i,
    })),
    ...input.skus
      .filter((s) => isUsableProductImageUrl(s.imageUrl))
      .map((s, i) => ({
        tenantId,
        productId,
        kind: "sku_image",
        sourceUrl: s.imageUrl as string,
        sortOrder: i,
      })),
  ];
}

export async function upsertSourceShop(
  tenantId: string,
  data: {
    shopId?: string;
    shopName: string;
    shopUrl?: string;
    contactName?: string;
    wangwang?: string;
    phone?: string;
    location?: string;
  },
  rawJson?: unknown,
) {
  const supplierName = data.shopName || data.shopUrl || "未知供应商";
  const supplier = await prisma.supplier.upsert({
    where: { id: `${tenantId}:${supplierName}` },
    update: {
      shopUrl: data.shopUrl,
      contactName: data.contactName,
      wangwang: data.wangwang,
      phone: data.phone,
      address: data.location,
    },
    create: {
      id: `${tenantId}:${supplierName}`,
      tenantId,
      name: supplierName,
      shopUrl: data.shopUrl,
      contactName: data.contactName,
      wangwang: data.wangwang,
      phone: data.phone,
      address: data.location,
    },
  });

  let shop = null;
  if (data.shopId) {
    shop = await prisma.sourceShop.findFirst({
      where: { tenantId, shopId: data.shopId },
    });
  }
  if (!shop && data.shopUrl) {
    shop = await prisma.sourceShop.findFirst({
      where: { tenantId, shopUrl: data.shopUrl },
    });
  }

  if (shop) {
    shop = await prisma.sourceShop.update({
      where: { id: shop.id },
      data: {
        shopName: data.shopName,
        shopUrl: data.shopUrl ?? shop.shopUrl,
        contactName: data.contactName ?? shop.contactName,
        wangwang: data.wangwang ?? shop.wangwang,
        phone: data.phone ?? shop.phone,
        location: data.location ?? shop.location,
        supplierId: supplier.id,
        lastSeenAt: new Date(),
        // rawJson 不被覆盖
      },
    });
  } else {
    shop = await prisma.sourceShop.create({
      data: {
        tenantId,
        shopId: data.shopId ?? null,
        shopName: data.shopName,
        shopUrl: data.shopUrl ?? null,
        contactName: data.contactName ?? null,
        wangwang: data.wangwang ?? null,
        phone: data.phone ?? null,
        location: data.location ?? null,
        rawJson: (rawJson as never) ?? null,
        supplierId: supplier.id,
        lastSeenAt: new Date(),
      },
    });
  }
  return shop;
}

export async function importProduct(
  tenantId: string,
  input: SourceProductImport,
) {
  const cleanInput = cleanProductMedia(input);
  const shop = await upsertSourceShop(
    tenantId,
    {
      shopId: input.shop.shopId,
      shopName: input.shop.shopName ?? "未知店铺",
      shopUrl: input.shop.shopUrl,
      contactName: input.shop.contactName,
      wangwang: input.shop.wangwang,
      phone: input.shop.phone,
      location: input.shop.location,
    },
    { shop: input.shop },
  );

  const existing = await prisma.sourceProduct.findFirst({
    where: { tenantId, offerId: input.offerId },
  });

  let product;
  if (existing) {
    product = await prisma.sourceProduct.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        sourceUrl: input.sourceUrl,
        shopId: shop.id,
        rawJson: input as never,
        capturedAt: parseDate(input.capturedAt),
        status: "imported",
        // rawJson 不被覆盖
      },
    });
  } else {
    product = await prisma.sourceProduct.create({
      data: {
        tenantId,
        offerId: input.offerId,
        title: input.title,
        sourceUrl: input.sourceUrl,
        shopId: shop.id,
        rawJson: input as never,
        capturedAt: parseDate(input.capturedAt),
        status: "imported",
      },
    });
  }

  const fact = normalizeProduct(cleanInput);
  const existingFact = await prisma.productFact.findFirst({
    where: { tenantId, productId: product.id },
  });
  if (existingFact) {
    await prisma.productFact.update({
      where: { id: existingFact.id },
      data: { normalizedJson: fact as never },
    });
  } else {
    await prisma.productFact.create({
      data: {
        tenantId,
        productId: product.id,
        normalizedJson: fact as never,
      },
    });
  }

  const items = sourceProductAssets(tenantId, product.id, cleanInput);
  await prisma.productAsset.deleteMany({
    where: {
      tenantId,
      productId: product.id,
      kind: { in: ["main_image", "detail_image", "sku_image"] },
    },
  });
  if (items.length > 0) {
    await prisma.productAsset.createMany({ data: items });
  }

  return { productId: product.id, isNew: !existing };
}

export async function importShop(
  tenantId: string,
  input: SourceShopImport,
) {
  const shop = await upsertSourceShop(
    tenantId,
    {
      shopId: input.shopId,
      shopName: input.shopName,
      shopUrl: input.shopUrl,
      contactName: input.contact?.wangwang,
      wangwang: input.contact?.wangwang,
      phone: input.contact?.phone,
      location: input.contact?.address,
    },
    { shop: input.shopId, shopName: input.shopName, shopUrl: input.shopUrl, contact: input.contact },
  );

  const existingSnapshots = await prisma.shopProductSnapshot.findMany({
    where: { tenantId, shopId: shop.id },
    select: { offerId: true },
  });
  const prevIds = new Set(existingSnapshots.map((s) => s.offerId));

  const { newProducts, knownProducts } = diffShopProducts(
    prevIds,
    input.products,
  );

  const run = await prisma.shopSyncRun.create({
    data: {
      tenantId,
      shopId: shop.id,
      status: "running",
      totalCount: input.products.length,
      newCount: newProducts.length,
    },
  });

  for (const p of newProducts) {
    await prisma.shopProductSnapshot.create({
      data: {
        tenantId,
        shopId: shop.id,
        offerId: p.offerId,
        title: p.title,
        url: p.url,
        imageUrl: p.imageUrl ?? null,
        priceText: p.priceText ?? null,
        soldText: p.soldText ?? null,
        snapshotHash: snapshotHash(p),
        followStatus: "NEW",
        syncRunId: run.id,
      },
    });
  }

  const knownIds = knownProducts.map((p) => p.offerId);
  for (const p of knownProducts) {
    await prisma.shopProductSnapshot.updateMany({
      where: { shopId: shop.id, offerId: p.offerId },
      data: {
        lastSeenAt: new Date(),
        snapshotHash: snapshotHash(p),
        syncRunId: run.id,
        title: p.title,
        url: p.url,
        imageUrl: p.imageUrl ?? null,
        priceText: p.priceText ?? null,
        soldText: p.soldText ?? null,
      },
    });
  }
  // 已知（非忽略、非已入池）的商品再次出现 → KNOWN
  if (knownIds.length > 0) {
    await prisma.shopProductSnapshot.updateMany({
      where: {
        shopId: shop.id,
        offerId: { in: knownIds },
        followStatus: { notIn: ["IGNORED", "IMPORTED_TO_PRODUCT_POOL"] },
      },
      data: { followStatus: "KNOWN" },
    });
  }

  // 本次未出现的商品 → 只标记，不下架
  const seenIds = new Set(input.products.map((p) => p.offerId));
  const disappeared = [...prevIds].filter((id) => !seenIds.has(id));
  if (disappeared.length > 0) {
    await prisma.shopProductSnapshot.updateMany({
      where: {
        shopId: shop.id,
        offerId: { in: disappeared },
        followStatus: { not: "IGNORED" },
      },
      data: { followStatus: "NOT_SEEN_IN_LATEST_SYNC" },
    });
  }

  await prisma.shopSyncRun.update({
    where: { id: run.id },
    data: { status: "done", finishedAt: new Date() },
  });

  return {
    syncRunId: run.id,
    shopId: shop.id,
    newCount: newProducts.length,
    totalCount: input.products.length,
  };
}

export async function updateShopSnapshotStatus(
  tenantId: string,
  shopId: string,
  snapshotIds: string[],
  action: "ignore" | "restore",
) {
  const ids = [...new Set(snapshotIds.filter(Boolean))];
  if (ids.length === 0) return { updated: 0 };

  const result = await prisma.shopProductSnapshot.updateMany({
    where: {
      tenantId,
      shopId,
      id: { in: ids },
      followStatus: action === "ignore" ? "NEW" : "IGNORED",
    },
    data: {
      followStatus: action === "ignore" ? "IGNORED" : "NEW",
    },
  });

  return { updated: result.count };
}

/** 把人工选中的 NEW 快照加入商品池。 */
export async function importNewProductsToPool(
  tenantId: string,
  shopId: string,
  snapshotIds: string[],
) {
  const ids = [...new Set(snapshotIds.filter(Boolean))];
  if (ids.length === 0) return { imported: 0, scanned: 0 };

  const snapshots = await prisma.shopProductSnapshot.findMany({
    where: { tenantId, shopId, id: { in: ids }, followStatus: "NEW" },
    take: 200,
  });

  let imported = 0;
  for (const s of snapshots) {
    const existing = await prisma.sourceProduct.findFirst({
      where: { tenantId, offerId: s.offerId },
    });
    if (!existing) {
      await prisma.sourceProduct.create({
        data: {
          tenantId,
          offerId: s.offerId,
          title: s.title,
          sourceUrl: s.url,
          shopId,
          rawJson: {
            source: "1688",
            offerId: s.offerId,
            title: s.title,
            url: s.url,
            imageUrl: s.imageUrl,
            priceText: s.priceText,
            soldText: s.soldText,
          } as never,
          capturedAt: new Date(),
        },
      });
      imported++;
    }
    await prisma.shopProductSnapshot.update({
      where: { id: s.id },
      data: { followStatus: "IMPORTED_TO_PRODUCT_POOL" },
    });
  }

  return { imported, scanned: snapshots.length };
}
