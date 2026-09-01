import type {
  CategoryAttribute,
  CategoryNode,
  DeleteProductsRequest,
  ImportPicturesRequest,
  ImportPricesRequest,
  ImportPricesResult,
  ImportProductsRequest,
  ImportProductsResult,
  OzonListProductsResult,
  OzonPostingItem,
  OzonProductInfoItem,
  OzonProductStockItem,
  ProductArchiveRequest,
  ProductMutationResult,
  UpdateAttributesRequest,
  UpdateStocksRequest,
} from "./types";

export type OzonClientOptions = {
  clientId: string;
  apiKey: string;
  baseUrl?: string;
  enableRealSubmit?: boolean;
};

function resolveEnableRealSubmit(opt?: boolean): boolean {
  if (typeof opt === "boolean") return opt;
  return process.env.ENABLE_REAL_OZON_SUBMIT === "true";
}

function normalizeClientId(clientId: string): string {
  const normalized = clientId.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error("Ozon Client ID must be a positive integer");
  }
  return normalized;
}

function parseOzonError(text: string): {
  code?: string | number;
  message?: string;
  details?: unknown;
} {
  try {
    const json = JSON.parse(text) as {
      code?: string | number;
      message?: string;
      error?: string;
      details?: unknown;
    };
    return {
      code: json.code,
      message: json.message ?? json.error,
      details: json.details ?? json,
    };
  } catch {
    return { message: text };
  }
}

export class OzonApiError extends Error {
  readonly path: string;
  readonly status: number;
  readonly code?: string | number;
  readonly details?: unknown;

  constructor(params: {
    path: string;
    status: number;
    code?: string | number;
    message: string;
    details?: unknown;
  }) {
    super(`Ozon API ${params.path} returned ${params.status}: ${params.message}`);
    this.name = "OzonApiError";
    this.path = params.path;
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
}

export class OzonClient {
  readonly clientId: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly enableRealSubmit: boolean;

  constructor(options: OzonClientOptions) {
    this.clientId = normalizeClientId(options.clientId);
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? process.env.OZON_API_BASE ?? "https://api-seller.ozon.ru";
    this.enableRealSubmit = resolveEnableRealSubmit(options.enableRealSubmit);
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Client-Id": this.clientId,
        "Api-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      const parsed = parseOzonError(text);
      throw new OzonApiError({
        path,
        status: res.status,
        code: parsed.code,
        message: parsed.message ?? text,
        details: parsed.details,
      });
    }
    return (await res.json()) as T;
  }

  private async mutationRequest<T>(path: string, body: unknown): Promise<T> {
    if (!this.enableRealSubmit) {
      throw new Error("ENABLE_REAL_OZON_SUBMIT=false; real Ozon submit API calls are disabled");
    }
    return this.request<T>(path, body);
  }

  async importProducts(
    payload: ImportProductsRequest,
  ): Promise<ImportProductsResult> {
    const res = await this.mutationRequest<{ result: { task_id: number } }>(
      "/v3/product/import",
      payload,
    );
    return { task_id: res.result.task_id };
  }

  async importPrices(payload: ImportPricesRequest): Promise<ImportPricesResult> {
    const res = await this.mutationRequest<{ result?: { task_id?: number } }>(
      "/v1/product/import/prices",
      payload,
    );
    return { task_id: res.result?.task_id, raw: res };
  }

  async archiveProducts(payload: ProductArchiveRequest): Promise<ProductMutationResult> {
    const res = await this.mutationRequest<unknown>("/v1/product/archive", payload);
    return { raw: res };
  }

  async unarchiveProducts(payload: ProductArchiveRequest): Promise<ProductMutationResult> {
    const res = await this.mutationRequest<unknown>("/v1/product/unarchive", payload);
    return { raw: res };
  }

  async updateStocks(payload: UpdateStocksRequest): Promise<ProductMutationResult> {
    const res = await this.mutationRequest<unknown>("/v2/products/stocks", payload);
    return { raw: res };
  }

  async importPictures(payload: ImportPicturesRequest): Promise<ProductMutationResult> {
    const res = await this.mutationRequest<unknown>("/v1/product/pictures/import", payload);
    return { raw: res };
  }

  async updateAttributes(payload: UpdateAttributesRequest): Promise<ProductMutationResult> {
    const res = await this.mutationRequest<unknown>("/v1/product/attributes/update", payload);
    return { raw: res };
  }

  async deleteProducts(payload: DeleteProductsRequest): Promise<ProductMutationResult> {
    const res = await this.mutationRequest<unknown>("/v2/products/delete", payload);
    return { raw: res };
  }

  async getCategoryTree(): Promise<CategoryNode[]> {
    const res = await this.request<{ result: CategoryNode[] }>(
      "/v1/description-category/tree",
      { language: "RU" },
    );
    return res.result;
  }

  async getCategoryAttributes(
    categoryId: number,
  ): Promise<CategoryAttribute[]> {
    const res = await this.request<{ result: CategoryAttribute[] }>(
      "/v1/description-category/attribute",
      {
        description_category_id: categoryId,
        language: "RU",
        type: "ALL",
      },
    );
    return res.result;
  }

  async getAttributeValues(
    categoryId: number,
    attributeId: number,
  ): Promise<Array<{ id: number; value: string }>> {
    const res = await this.request<{
      result: Array<{ id: number; value: string }>;
    }>("/v1/description-category/attribute/values", {
      description_category_id: categoryId,
      attribute_id: attributeId,
      language: "RU",
      limit: 100,
      last_value_id: 0,
    });
    return res.result;
  }

  async listProducts(limit = 1000): Promise<OzonListProductsResult> {
    const res = await this.request<{ result: OzonListProductsResult }>(
      "/v3/product/list",
      {
        filter: {},
        limit,
      },
    );
    return {
      items: res.result.items ?? [],
      total: res.result.total,
      last_id: res.result.last_id,
    };
  }

  async getProductInfoList(params: {
    productIds?: string[];
    offerIds?: string[];
  }): Promise<OzonProductInfoItem[]> {
    const res = await this.request<{ items?: OzonProductInfoItem[]; result?: { items?: OzonProductInfoItem[] } }>(
      "/v3/product/info/list",
      {
        product_id: params.productIds ?? [],
        offer_id: params.offerIds ?? [],
      },
    );
    return res.items ?? res.result?.items ?? [];
  }

  async getProductStocks(params: {
    productIds?: string[];
    offerIds?: string[];
    limit?: number;
  } = {}): Promise<OzonProductStockItem[]> {
    const res = await this.request<{ items?: OzonProductStockItem[]; result?: { items?: OzonProductStockItem[] } }>(
      "/v4/product/info/stocks",
      {
        filter: {
          product_id: params.productIds ?? [],
          offer_id: params.offerIds ?? [],
          visibility: "ALL",
        },
        limit: params.limit ?? 1000,
      },
    );
    return res.items ?? res.result?.items ?? [];
  }

  async listFbsPostings(params: {
    since: Date;
    to: Date;
    limit?: number;
  }): Promise<OzonPostingItem[]> {
    const res = await this.request<{ result?: { postings?: OzonPostingItem[] } }>(
      "/v4/posting/fbs/list",
      {
        dir: "ASC",
        filter: {
          since: params.since.toISOString(),
          to: params.to.toISOString(),
        },
        limit: params.limit ?? 1000,
        offset: 0,
        with: {
          analytics_data: false,
          barcodes: false,
          financial_data: true,
        },
      },
    );
    return res.result?.postings ?? [];
  }

  async listFboPostings(params: {
    since: Date;
    to: Date;
    limit?: number;
  }): Promise<OzonPostingItem[]> {
    const res = await this.request<{ result?: OzonPostingItem[] | { postings?: OzonPostingItem[] } }>(
      "/v2/posting/fbo/list",
      {
        dir: "ASC",
        filter: {
          since: params.since.toISOString(),
          to: params.to.toISOString(),
        },
        limit: params.limit ?? 1000,
        offset: 0,
        with: {
          analytics_data: false,
          financial_data: true,
        },
      },
    );
    if (Array.isArray(res.result)) return res.result;
    return res.result?.postings ?? [];
  }
}
