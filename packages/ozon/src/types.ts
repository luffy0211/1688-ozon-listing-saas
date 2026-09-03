/** Ozon 类目属性（编译 payload 时由类目匹配步骤填充真实 id）。 */
export type OzonAttribute = {
  id: number;
  values: Array<{ value: string; dictionaryValueId?: number; dictionary_value_id?: number }>;
};

/** Ozon 草稿编译输入（方案.md 第 17 节输出字段）。 */
export type OzonDraftInput = {
  offerId: string;
  titleRu: string;
  bulletPointsRu: string[];
  descriptionRu: string;
  searchKeywordsRu: string;
  descriptionCategoryId: number;
  typeId: number;
  attributes: OzonAttribute[];
  priceRub: number;
  currencyCode?: string;
  mainImages: string[];
  detailImages: string[];
  weightGrams: number;
  dimensions: { widthMm: number; heightMm: number; depthMm: number };
};

/**
 * Ozon /v3/product/import 的单个 item。
 * 注意：绝不包含 stock / 库存 / 仓库字段（方案.md 第 19 节）。
 */
export type OzonProductPayload = {
  offer_id: string;
  name: string;
  description: string;
  description_category_id: number;
  type_id: number;
  price: string;
  old_price: string;
  vat: string;
  currency_code: string;
  images: string[];
  attributes: OzonAttribute[];
  weight: number;
  width: number;
  height: number;
  depth: number;
  dimension_unit: "mm";
  weight_unit: "g";
  barcode?: string;
};

export type ImportProductsRequest = { items: OzonProductPayload[] };

export type ImportProductsResult = { task_id: number };

export type ImportPricesRequest = {
  prices: Array<{
    offer_id: string;
    price: string;
    old_price?: string;
    currency_code: string;
    vat?: string;
  }>;
};

export type ImportPricesResult = {
  task_id?: number;
  raw: unknown;
};

export type ProductArchiveRequest = {
  product_id: number[];
};

export type ProductMutationResult = {
  raw: unknown;
};

export type UpdateStocksRequest = {
  stocks: Array<{
    offer_id?: string;
    product_id?: number;
    stock: number;
    warehouse_id: number;
    quant_size?: number;
  }>;
};

export type ImportPicturesRequest = {
  product_id: number;
  images: string[];
  images360?: string[];
  color_image?: string;
};

export type UpdateAttributesRequest = {
  items: Array<{
    offer_id?: string;
    product_id?: number;
    attributes: OzonAttribute[];
  }>;
};

export type DeleteProductsRequest = {
  products: Array<{
    product_id?: number;
    offer_id?: string;
  }>;
};

export type CategoryNode = {
  category_id?: number;
  description_category_id?: number;
  id?: number;
  type_id?: number;
  title?: string;
  name?: string;
  category_name?: string;
  type_name?: string;
  children?: CategoryNode[];
};

export type CategoryAttribute = {
  id: number;
  attribute_id?: number;
  name: string;
  attribute_name?: string;
  description: string;
  type: string;
  is_collection: boolean;
  is_required: boolean;
  required?: boolean;
  dictionary_id?: number;
  allowed_values?: Array<{ id?: number; dictionary_value_id?: number; value: string }>;
};

export type OzonListProductsRequest = {
  filter?: {
    offer_id?: string[];
    product_id?: string[];
    visibility?: string;
  };
  last_id?: string;
  limit?: number;
};

export type OzonProductListItem = {
  product_id?: number;
  offer_id?: string;
  visibility?: string;
  archived?: boolean;
  has_stock?: boolean;
};

export type OzonListProductsResult = {
  items: OzonProductListItem[];
  total?: number;
  last_id?: string;
};

export type OzonProductInfoItem = {
  id?: number;
  product_id?: number;
  offer_id?: string;
  name?: string;
  visible?: boolean;
  archived?: boolean;
  status?: {
    state?: string;
    state_name?: string;
    status?: string;
  };
  price?: string;
  marketing_price?: string;
  old_price?: string;
  currency_code?: string;
  primary_image?: string;
  images?: string[];
};

export type OzonProductStockItem = {
  product_id?: number;
  offer_id?: string;
  stocks?: Array<{
    present?: number;
    reserved?: number;
    type?: string;
    warehouse_id?: number;
    warehouse_ids?: number[];
  }>;
};

export type OzonPostingItem = {
  posting_number?: string;
  status?: string;
  in_process_at?: string;
  shipment_date?: string;
  products?: Array<{
    offer_id?: string;
    sku?: number;
    name?: string;
    quantity?: number;
    price?: string;
    currency_code?: string;
  }>;
  financial_data?: {
    products?: Array<{
      offer_id?: string;
      product_id?: number;
      name?: string;
      price?: string;
      quantity?: number;
      payout?: string;
      total_discount_value?: string;
    }>;
  };
};

export type OzonAnalyticsProduct = {
  productId: string;
  offerId: string;
  name: string | null;
  status: string | null;
  visible: boolean;
  archived: boolean;
  stock: number;
  reservedStock: number;
  priceRub: number | null;
  imageUrl: string | null;
};

export type OzonOrderSummary = {
  orderCount: number;
  pendingShipmentCount: number;
  cancelledOrderCount: number;
  grossRevenueRub: number;
  dailyOrders: Array<{
    date: string;
    fbs: number;
    fbo: number;
  }>;
  topProducts: Array<{
    offerId: string;
    name: string | null;
    quantity: number;
    revenueRub: number;
  }>;
};

export type OzonAnalyticsSummary = {
  productCount: number;
  visibleProductCount: number;
  archivedProductCount: number;
  totalStock: number;
  lowStockCount: number;
  fbsOrderCount: number;
  fboOrderCount: number;
  pendingShipmentCount: number;
  cancelledOrderCount: number;
  grossRevenueRub: number;
  dailyOrders: OzonOrderSummary["dailyOrders"];
  topProducts: OzonOrderSummary["topProducts"];
  products: OzonAnalyticsProduct[];
  warnings?: string[];
};
