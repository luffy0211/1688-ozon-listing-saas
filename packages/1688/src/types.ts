/**
 * 1688 接口采集客户端 — 类型定义。
 * 登录态由调用方（服务端）持有并解密后以 CookieRecord 传入。
 */

/** cookie name -> value（从 storage_state 数组归一化而来）。 */
export type CookieRecord = Record<string, string>;

/** storage_state 风格的 cookie 元素。 */
export type CookieLike = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

/** 店铺商品列表项（mtop.1688.shop.data.get 的 offerList 归一化）。 */
export type ShopProductItem = {
  offerId: string;
  title: string;
  priceText: string;
  moq: string;
  sales: string;
  memberId: string;
  images: string[];
  url: string;
};

/** 商品详情（mtop.1688.wosc.queryOfferSkuSelectorModel + PC 详情页 HTML）。 */
export type ProductDetail = {
  offerId: string;
  title: string;
  sourceUrl: string;
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
  /** 叶子类目 ID（详情页 description.leafCategoryId，完整路径需类目树接口）。 */
  leafCategoryId?: number;
  /** 类目路径（如 ["女装","外套","风衣"]）；第一版通常为空，仅当能从页面拿到时填充。 */
  categoryPath?: string[];
  price: string;
  moq: string;
  sales: string;
  stock: string;
  shopName: string;
  shopUrl: string;
  shopId: string; // sellerMemberId b2b-xxx
  minOrderQuantity?: number;
};

/** 二维码登录会话（qrlogin.taobao.com）。 */
export type QrCodeSession = {
  lgToken: string;
  /** 二维码图片地址（//img.alicdn.com/...，需补 https:）。 */
  url: string;
};
