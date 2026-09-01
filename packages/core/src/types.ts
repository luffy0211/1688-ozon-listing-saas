/**
 * 采集合同：插件与后端之间的数据契约。
 * 与方案.md 第 7、8 节保持一致。
 */

export type SourceProductImport = {
  source: "1688";
  sourceUrl: string;
  offerId: string;
  capturedAt: string;
  shop: {
    shopId?: string;
    shopName?: string;
    shopUrl?: string;
    contactName?: string;
    wangwang?: string;
    phone?: string;
    location?: string;
  };
  title: string;
  categoryPath?: string[];
  priceTiers: Array<{ minQuantity: number; priceCny: number }>;
  properties: Array<{ name: string; value: string }>;
  skus: Array<{
    skuId: string;
    name: string;
    attributes: Record<string, string>;
    priceCny?: number;
    stockText?: string;
    imageUrl?: string;
  }>;
  mainImages: string[];
  detailImages: string[];
  descriptionHtml?: string;
  descriptionText?: string;
  logistics?: {
    shipFrom?: string;
    minOrderQuantity?: number;
    domesticShippingFeeCny?: number;
  };
};

export type SourceShopImport = {
  source: "1688";
  shopUrl: string;
  shopId?: string;
  shopName: string;
  capturedAt: string;
  contact?: {
    wangwang?: string;
    phone?: string;
    address?: string;
    companyName?: string;
  };
  products: Array<{
    offerId: string;
    title: string;
    url: string;
    imageUrl?: string;
    priceText?: string;
    soldText?: string;
  }>;
};

/** 估算字段：任何非采集、非用户确认的字段都必须标注。 */
export type Estimate<T> = {
  value: T;
  estimated: boolean;
  confidence: number; // 0..1
};

export type NormalizedProductFact = {
  title: string;
  categoryPath: string[];
  brand: Estimate<string>;
  properties: Array<{ name: string; value: string; estimated: boolean; confidence: number }>;
  priceTiers: Array<{ minQuantity: number; priceCny: number }>;
  skus: Array<{
    skuId: string;
    name: string;
    attributes: Record<string, string>;
    priceCny?: number;
    stockText?: string;
    imageUrl?: string;
  }>;
  purchaseCny: Estimate<number>;
  mainImages: string[];
  detailImages: string[];
  descriptionText?: string;
  logistics?: {
    shipFrom?: string;
    minOrderQuantity?: number;
    domesticShippingFeeCny?: number;
  };
};
