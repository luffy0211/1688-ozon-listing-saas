import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceProductImport } from "@saas/core";

const prisma = vi.hoisted(() => ({
  supplier: {
    upsert: vi.fn(),
  },
  sourceShop: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  sourceProduct: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  productFact: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  productAsset: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
}));

vi.mock("@saas/db", () => ({ prisma }));

import { importProduct } from "./services";

const input: SourceProductImport = {
  source: "1688",
  sourceUrl: "https://detail.1688.com/offer/111.html",
  offerId: "111",
  capturedAt: "2026-08-26T12:00:00.000Z",
  shop: {
    shopId: "b2b-1",
    shopName: "test shop",
    shopUrl: "https://shop.1688.com/",
  },
  title: "new title",
  categoryPath: ["319"],
  priceTiers: [{ minQuantity: 1, priceCny: 95 }],
  properties: [{ name: "material", value: "polyester" }],
  skus: [
    {
      skuId: "sku-1",
      name: "black>XL",
      attributes: { color: "black", size: "XL" },
      priceCny: 95,
      stockText: "999",
      imageUrl: "https://cbu01.alicdn.com/sku.jpg",
    },
    {
      skuId: "sku-2",
      name: "black>L",
      attributes: { color: "black", size: "L" },
      priceCny: 95,
    },
  ],
  mainImages: ["https://cbu01.alicdn.com/main.jpg"],
  detailImages: ["https://cbu01.alicdn.com/detail.jpg"],
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.supplier.upsert.mockResolvedValue({ id: "supplier-1" });
  prisma.sourceShop.findFirst.mockResolvedValue({
    id: "shop-1",
    shopUrl: "https://shop.1688.com/",
    contactName: null,
    wangwang: null,
    phone: null,
    location: null,
  });
  prisma.sourceShop.update.mockResolvedValue({ id: "shop-1" });
  prisma.sourceShop.create.mockResolvedValue({ id: "shop-1" });
  prisma.sourceProduct.findFirst.mockResolvedValue({ id: "product-1" });
  prisma.sourceProduct.update.mockImplementation(async (args) => ({
    id: args.where.id,
    ...args.data,
  }));
  prisma.productFact.findFirst.mockResolvedValue({ id: "fact-1" });
  prisma.productFact.update.mockResolvedValue({});
  prisma.productAsset.deleteMany.mockResolvedValue({ count: 3 });
  prisma.productAsset.createMany.mockResolvedValue({ count: 3 });
});

describe("importProduct", () => {
  it("refreshes existing product data and replaces only 1688 source assets", async () => {
    const result = await importProduct("tenant-1", input);

    expect(result).toEqual({ productId: "product-1", isNew: false });
    expect(prisma.sourceProduct.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: expect.objectContaining({
        title: "new title",
        sourceUrl: "https://detail.1688.com/offer/111.html",
        shopId: "shop-1",
        rawJson: input,
        status: "imported",
      }),
    });
    expect(prisma.productFact.update).toHaveBeenCalledWith({
      where: { id: "fact-1" },
      data: {
        normalizedJson: expect.objectContaining({
          properties: [
            {
              name: "material",
              value: "polyester",
              estimated: false,
              confidence: 1,
            },
          ],
          skus: expect.arrayContaining([
            expect.objectContaining({ skuId: "sku-1" }),
          ]),
          detailImages: ["https://cbu01.alicdn.com/detail.jpg"],
        }),
      },
    });
    expect(prisma.productAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        productId: "product-1",
        kind: { in: ["main_image", "detail_image", "sku_image"] },
      },
    });
    expect(prisma.productAsset.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId: "tenant-1",
          productId: "product-1",
          kind: "main_image",
          sourceUrl: "https://cbu01.alicdn.com/main.jpg",
          sortOrder: 0,
        },
        {
          tenantId: "tenant-1",
          productId: "product-1",
          kind: "detail_image",
          sourceUrl: "https://cbu01.alicdn.com/detail.jpg",
          sortOrder: 0,
        },
        {
          tenantId: "tenant-1",
          productId: "product-1",
          kind: "sku_image",
          sourceUrl: "https://cbu01.alicdn.com/sku.jpg",
          sortOrder: 0,
        },
      ],
    });
  });

  it("does not create an empty asset batch", async () => {
    await importProduct("tenant-1", {
      ...input,
      mainImages: [],
      detailImages: [],
      skus: input.skus.map((sku) => ({ ...sku, imageUrl: undefined })),
    });

    expect(prisma.productAsset.deleteMany).toHaveBeenCalled();
    expect(prisma.productAsset.createMany).not.toHaveBeenCalled();
  });
});
