import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/crypto";

const prisma = new PrismaClient();

const tenantId = "local-demo-tenant";
const storeId = "local-demo-ozon-store";
const shopId = "local-demo-1688-shop";
const supplierId = "local-demo-supplier";

const products = [
  {
    offerId: "demo-1688-1001",
    title: "儿童保温水杯 316 不锈钢带吸管",
    priceCny: 18.8,
    mainImage: "https://picsum.photos/seed/ozon-demo-cup-main/800/800",
    detailImage: "https://picsum.photos/seed/ozon-demo-cup-detail/1000/1400",
    categoryPath: ["日用百货", "杯具", "儿童水杯"],
    properties: [
      { name: "材质", value: "316 不锈钢" },
      { name: "容量", value: "500ml" },
      { name: "颜色", value: "粉色/蓝色/绿色" },
    ],
  },
  {
    offerId: "demo-1688-1002",
    title: "厨房硅胶铲不粘锅专用耐高温厨具",
    priceCny: 6.5,
    mainImage: "https://picsum.photos/seed/ozon-demo-spatula-main/800/800",
    detailImage: "https://picsum.photos/seed/ozon-demo-spatula-detail/1000/1400",
    categoryPath: ["厨房用品", "烹饪工具", "锅铲"],
    properties: [
      { name: "材质", value: "食品级硅胶" },
      { name: "耐温", value: "约 230 度" },
      { name: "规格", value: "单只装" },
    ],
  },
  {
    offerId: "demo-1688-1003",
    title: "桌面收纳盒多格化妆品文具整理盒",
    priceCny: 12.9,
    mainImage: "https://picsum.photos/seed/ozon-demo-storage-main/800/800",
    detailImage: "https://picsum.photos/seed/ozon-demo-storage-detail/1000/1400",
    categoryPath: ["家居收纳", "桌面收纳", "收纳盒"],
    properties: [
      { name: "材质", value: "PP" },
      { name: "层数", value: "多格" },
      { name: "适用场景", value: "桌面/梳妆台/办公桌" },
    ],
  },
];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: { id: tenantId, name: "本地演示租户" },
  });

  await prisma.store.upsert({
    where: { id: storeId },
    update: { isDefault: true },
    create: {
      id: storeId,
      tenantId: tenant.id,
      name: "演示 Ozon 店铺",
      ozonClientId: "demo-client-id",
      ozonApiKey: encryptSecret("demo-ozon-api-key"),
      translationVendor: "DeepL",
      isDefault: true,
    },
  });

  await prisma.xiangjiCredential.upsert({
    where: { id: "local-demo-xiangji" },
    update: {},
    create: {
      id: "local-demo-xiangji",
      tenantId: tenant.id,
      name: "演示象寄 Key",
      apiKey: encryptSecret("demo-xiangji-api-key"),
    },
  });

  const supplier = await prisma.supplier.upsert({
    where: { id: supplierId },
    update: {},
    create: {
      id: supplierId,
      tenantId: tenant.id,
      name: "义乌演示百货供应商",
      companyName: "义乌市演示日用品有限公司",
      shopUrl: "https://demo.1688.com/page/index.html",
      contactName: "王经理",
      wangwang: "demo-wangwang",
      phone: "13800000000",
      address: "浙江省金华市义乌市",
      mainCategory: "日用百货",
    },
  });

  const shop = await prisma.sourceShop.upsert({
    where: { id: shopId },
    update: {
      supplierId: supplier.id,
      lastSeenAt: new Date(),
    },
    create: {
      id: shopId,
      tenantId: tenant.id,
      supplierId: supplier.id,
      shopId: "demo-shop-1688",
      shopName: "义乌演示百货工厂店",
      shopUrl: "https://demo.1688.com/page/index.html",
      contactName: "王经理",
      wangwang: "demo-wangwang",
      phone: "13800000000",
      location: "浙江义乌",
      rawJson: { source: "1688", demo: true },
      lastSeenAt: new Date(),
    },
  });

  await prisma.shopSyncRun.create({
    data: {
      tenantId: tenant.id,
      shopId: shop.id,
      status: "done",
      totalCount: products.length,
      newCount: products.length,
      finishedAt: new Date(),
    },
  });

  for (const [index, product] of products.entries()) {
    const sourceUrl = `https://detail.1688.com/offer/${product.offerId}.html`;
    const rawJson = {
      source: "1688",
      sourceUrl,
      offerId: product.offerId,
      capturedAt: new Date().toISOString(),
      shop: {
        shopId: "demo-shop-1688",
        shopName: shop.shopName,
        shopUrl: shop.shopUrl,
        contactName: "王经理",
        wangwang: "demo-wangwang",
        phone: "13800000000",
        location: "浙江义乌",
      },
      title: product.title,
      categoryPath: product.categoryPath,
      priceTiers: [{ minQuantity: 1, priceCny: product.priceCny }],
      properties: product.properties,
      skus: [
        {
          skuId: `${product.offerId}-sku-1`,
          name: "默认规格",
          attributes: { 规格: "默认规格" },
          priceCny: product.priceCny,
          stockText: "现货",
          imageUrl: product.mainImage,
        },
      ],
      mainImages: [product.mainImage],
      detailImages: [product.detailImage],
      descriptionText: `${product.title}，适合 Ozon 店铺测试采集、翻译、定价和 mock 上架流程。`,
      logistics: {
        shipFrom: "义乌",
        minOrderQuantity: 1,
        domesticShippingFeeCny: 3,
      },
    };

    const sourceProduct = await prisma.sourceProduct.upsert({
      where: { tenantId_offerId: { tenantId: tenant.id, offerId: product.offerId } },
      update: {
        title: product.title,
        sourceUrl,
        shopId: shop.id,
        rawJson,
        capturedAt: new Date(),
      },
      create: {
        tenantId: tenant.id,
        offerId: product.offerId,
        title: product.title,
        sourceUrl,
        shopId: shop.id,
        rawJson,
        capturedAt: new Date(),
      },
    });

    await prisma.productFact.deleteMany({
      where: { tenantId: tenant.id, productId: sourceProduct.id },
    });
    await prisma.productFact.create({
      data: {
        tenantId: tenant.id,
        productId: sourceProduct.id,
        normalizedJson: {
          title: product.title,
          categoryPath: product.categoryPath,
          brand: { value: "无品牌", estimated: false, confidence: 1 },
          properties: product.properties.map((p) => ({
            ...p,
            estimated: false,
            confidence: 1,
          })),
          priceTiers: rawJson.priceTiers,
          skus: rawJson.skus,
          purchaseCny: { value: product.priceCny, estimated: true, confidence: 0.8 },
          mainImages: [product.mainImage],
          detailImages: [product.detailImage],
          descriptionText: rawJson.descriptionText,
          logistics: rawJson.logistics,
        },
      },
    });

    await prisma.productAsset.deleteMany({
      where: { tenantId: tenant.id, productId: sourceProduct.id },
    });
    await prisma.productAsset.createMany({
      data: [
        {
          tenantId: tenant.id,
          productId: sourceProduct.id,
          kind: "main_image",
          sourceUrl: product.mainImage,
          publicUrl: product.mainImage,
          sortOrder: 0,
        },
        {
          tenantId: tenant.id,
          productId: sourceProduct.id,
          kind: "detail_image",
          sourceUrl: product.detailImage,
          publicUrl: product.detailImage,
          sortOrder: 0,
        },
      ],
    });

    await prisma.shopProductSnapshot.upsert({
      where: { shopId_offerId: { shopId: shop.id, offerId: product.offerId } },
      update: {
        followStatus: "IMPORTED_TO_PRODUCT_POOL",
        title: product.title,
        url: sourceUrl,
        imageUrl: product.mainImage,
        priceText: `${product.priceCny}`,
        lastSeenAt: new Date(),
      },
      create: {
        tenantId: tenant.id,
        shopId: shop.id,
        offerId: product.offerId,
        title: product.title,
        url: sourceUrl,
        imageUrl: product.mainImage,
        priceText: `${product.priceCny}`,
        soldText: `${100 + index * 37} 件成交`,
        snapshotHash: `${product.offerId}-demo`,
        followStatus: "IMPORTED_TO_PRODUCT_POOL",
      },
    });
  }

  console.log(`Seeded ${products.length} demo products for tenant ${tenant.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
