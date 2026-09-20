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

export type ImportProductTaskError = {
  code?: string;
  field?: string;
  level?: string;
  message?: string;
  description?: string;
  attribute_id?: number;
  attribute_name?: string;
  state?: string;
};

export type ImportProductTaskItem = {
  offer_id?: string;
  product_id?: number;
  status?: string;
  errors?: ImportProductTaskError[];
};

export type ImportProductTaskInfoResult = {
  items: ImportProductTaskItem[];
  total?: number;
  raw: unknown;
};

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
  description_category_id?: number;
  type_id?: number;
  sources?: Array<{
    sku?: number;
    source?: string;
  }>;
  description?: string;
  attributes?: OzonAttribute[];
  weight?: number;
  width?: number;
  height?: number;
  depth?: number;
  dimension_unit?: string;
  weight_unit?: string;
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

export type OzonProductRating = {
  sku: number;
  rating: number;
  groups: Array<{
    key: string;
    name: string;
    rating: number;
    weight: number;
    improve_at_least: number;
    conditions: Array<{
      key: string;
      description: string;
      fulfilled: boolean;
      cost: number;
    }>;
    improve_attributes: Array<{
      id: number;
      name: string;
    }>;
  }>;
};

export type OzonFinanceTransactionType =
  | "all"
  | "orders"
  | "returns"
  | "services"
  | "compensation"
  | "transferDelivery"
  | "other";

export type OzonFinanceTransactionFilter = {
  operation_type?: string[];
  transaction_type?: OzonFinanceTransactionType;
} & (
  | { date: { from: string; to: string }; posting_number?: string }
  | { date?: never; posting_number: string }
);

export type OzonFinanceTransactionListRequest = {
  filter: OzonFinanceTransactionFilter;
  page: number;
  page_size: number;
};

export type OzonFinanceTransaction = {
  operation_id: number;
  operation_type: string;
  operation_date: string;
  operation_type_name: string;
  delivery_charge: number;
  return_delivery_charge: number;
  accruals_for_sale: number;
  sale_commission: number;
  amount: number;
  type: OzonFinanceTransactionType;
  posting: {
    delivery_schema: string;
    order_date: string;
    posting_number: string;
    warehouse_id: number;
  };
  items: Array<{
    name?: string;
    sku?: number;
    offer_id?: string;
  }>;
  services: Array<{
    name?: string;
    price?: number;
  }>;
};

export type OzonFinanceTransactionListResult = {
  operations: OzonFinanceTransaction[];
  page_count: number;
  row_count: number;
};

export type OzonAction = {
  id: number;
  title: string;
  action_type: string;
  description: string;
  date_start: string;
  date_end: string;
  auto_add_dates: string[];
  freeze_date: string;
  potential_products_count: number;
  participating_products_count: number;
  is_participating: boolean;
  is_voucher_action: boolean;
  banned_products_count: number;
  with_targeting: boolean;
  order_amount: number;
  discount_type: string;
  discount_value: number;
};

export type OzonActionProductsRequest = {
  action_id: number;
  limit?: number;
  offset?: number;
  last_id?: string | number;
};

export type OzonActionProduct = {
  id: number;
  price: number;
  action_price: number;
  alert_max_action_price_failed: boolean;
  alert_max_action_price: number;
  max_action_price: number;
  add_mode: string;
  stock: number;
  min_stock: number;
  current_boost?: number;
  price_min_elastic?: number;
  price_max_elastic?: number;
  min_boost?: number;
  max_boost?: number;
};

export type OzonActionProductsResult = {
  products: OzonActionProduct[];
  total: number;
  last_id?: string | number;
};

export type OzonActivateActionProductsRequest = {
  action_id: number;
  products: Array<{
    product_id: number;
    action_price: number;
  }>;
};

export type OzonActivateActionProductsResult = {
  product_ids: number[];
  rejected: Array<{
    product_id: number;
    reason: string;
  }>;
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
  publicSku: string | null;
  descriptionCategoryId: number | null;
  typeId: number | null;
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
