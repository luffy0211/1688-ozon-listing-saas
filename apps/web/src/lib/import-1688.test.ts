import { describe, expect, it } from "vitest";
import type { ProductDetail, ShopProductItem } from "@saas/1688";
import {
  detailToSourceProductImport,
  selectNewShopProducts,
  shopProductItemToSourceProductImport,
  shopProductsToSourceShopImport,
} from "./import-1688";

const shopItems: ShopProductItem[] = [
  {
    offerId: "111",
    title: "连衣裙",
    priceText: "45.00",
    moq: "2",
    sales: "3200",
    memberId: "b2b-1",
    images: ["https://cbu01.alicdn.com/img/1.jpg"],
    url: "https://detail.1688.com/offer/111.html",
  },
];

describe("selectNewShopProducts", () => {
  it("skips existing products without consuming the collection limit", () => {
    const products = ["1", "2", "3", "4", "5"].map((offerId) => ({
      ...shopItems[0]!,
      offerId,
    }));

    expect(selectNewShopProducts(products, new Set(["1", "3"]), 3).map((p) => p.offerId)).toEqual([
      "2",
      "4",
      "5",
    ]);
  });
});

describe("shopProductsToSourceShopImport", () => {
  it("映射为 SourceShopImport 合同", () => {
    const s = shopProductsToSourceShopImport(
      "https://shop.1688.com/",
      "测试店铺",
      "b2b-1",
      shopItems,
    );
    expect(s.source).toBe("1688");
    expect(s.shopName).toBe("测试店铺");
    expect(s.shopId).toBe("b2b-1");
    expect(s.products[0]).toMatchObject({
      offerId: "111",
      title: "连衣裙",
      url: "https://detail.1688.com/offer/111.html",
      imageUrl: "https://cbu01.alicdn.com/img/1.jpg",
      priceText: "45.00",
      soldText: "3200",
    });
  });
});

describe("shopProductItemToSourceProductImport", () => {
  it("maps shop list item directly into product pool import contract", () => {
    const product = shopProductItemToSourceProductImport(
      "https://shop.1688.com/",
      "test shop",
      "b2b-1",
      shopItems[0]!,
    );

    expect(product).toMatchObject({
      source: "1688",
      sourceUrl: "https://detail.1688.com/offer/111.html",
      offerId: "111",
      shop: {
        shopId: "b2b-1",
        shopName: "test shop",
        shopUrl: "https://shop.1688.com/",
      },
      priceTiers: [{ minQuantity: 2, priceCny: 45 }],
      mainImages: ["https://cbu01.alicdn.com/img/1.jpg"],
      detailImages: [],
    });
  });
});

const detail: ProductDetail = {
  offerId: "111",
  title: "连衣裙",
  sourceUrl: "https://detail.1688.com/offer/111.html",
  properties: [{ name: "面料", value: "棉" }],
  skus: [
    {
      skuId: "s1",
      name: "蓝色>S",
      attributes: { 颜色: "蓝色", 尺码: "S" },
      priceCny: 45,
      stockText: "100",
      imageUrl: "https://cbu01.alicdn.com/sku.jpg",
    },
  ],
  mainImages: ["https://cbu01.alicdn.com/m1.jpg"],
  detailImages: [],
  price: "45",
  moq: "2",
  sales: "3200",
  stock: "500",
  shopName: "杭州XX服饰厂",
  shopUrl: "https://shop.1688.com/",
  shopId: "b2b-1",
  minOrderQuantity: 2,
};

describe("detailToSourceProductImport", () => {
  it("映射为 SourceProductImport 合同", () => {
    const p = detailToSourceProductImport(detail);
    expect(p.source).toBe("1688");
    expect(p.offerId).toBe("111");
    expect(p.shop.shopId).toBe("b2b-1");
    expect(p.shop.shopName).toBe("杭州XX服饰厂");
    expect(p.priceTiers).toEqual([{ minQuantity: 2, priceCny: 45 }]);
    expect(p.mainImages).toEqual(["https://cbu01.alicdn.com/m1.jpg"]);
    expect(p.skus[0]).toMatchObject({
      skuId: "s1",
      attributes: { 颜色: "蓝色", 尺码: "S" },
      priceCny: 45,
    });
    expect(p.logistics).toEqual({ minOrderQuantity: 2 });
  });

  it("价格为 0 时不生成 priceTiers", () => {
    const p = detailToSourceProductImport({ ...detail, price: "0", moq: "" });
    expect(p.priceTiers).toEqual([]);
  });
});
