import type {
  CategoryAttribute,
  CategoryNode,
  DeleteProductsRequest,
  ImportPicturesRequest,
  ImportPricesRequest,
  ImportPricesResult,
  ImportProductsRequest,
  ImportProductsResult,
  OzonAction,
  OzonActionProductsRequest,
  OzonActionProductsResult,
  OzonActivateActionProductsRequest,
  OzonActivateActionProductsResult,
  OzonFinanceTransactionListRequest,
  OzonFinanceTransactionListResult,
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

function unwrapOzonResult<T>(response: T | { result: T }): T {
  if (typeof response === "object" && response !== null && "result" in response) {
    return response.result;
  }
  return response;
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

  private async request<T>(
    path: string,
    body?: unknown,
    method: "GET" | "POST" = "POST",
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Client-Id": this.clientId,
        "Api-Key": this.apiKey,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    typeId: number,
  ): Promise<CategoryAttribute[]> {
    const res = await this.request<{ result: CategoryAttribute[] }>(
      "/v1/description-category/attribute",
      {
        description_category_id: categoryId,
        type_id: typeId,
        language: "RU",
      },
    );
    return res.result;
  }

  async getAttributeValues(
    categoryId: number,
    typeId: number,
    attributeId: number,
  ): Promise<Array<{ id: number; value: string }>> {
    const values: Array<{ id: number; value: string }> = [];
    let lastValueId = 0;
    for (let page = 0; page < 10; page++) {
      const res = await this.request<{
        result: Array<{ id: number; value: string }>;
        has_next?: boolean;
      }>("/v1/description-category/attribute/values", {
        description_category_id: categoryId,
        type_id: typeId,
        attribute_id: attributeId,
        language: "RU",
        limit: 5000,
        last_value_id: lastValueId,
      });
      values.push(...res.result);
      if (!res.has_next) return values;
      const nextId = res.result.at(-1)?.id;
      if (!nextId || nextId <= lastValueId) {
        throw new Error("Ozon attribute values pagination did not advance");
      }
      lastValueId = nextId;
    }
    return values;
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
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 100);
    const postings: OzonPostingItem[] = [];
    for (let offset = 0; offset < 10_000; offset += limit) {
      const res = await this.request<{
        postings?: OzonPostingItem[];
        has_next?: boolean;
        result?: { postings?: OzonPostingItem[]; has_next?: boolean };
      }>("/v4/posting/fbs/list", {
        dir: "ASC",
        filter: {
          since: params.since.toISOString(),
          to: params.to.toISOString(),
        },
        limit,
        offset,
        with: {
          analytics_data: false,
          barcodes: false,
          financial_data: true,
        },
      });
      const page = res.postings ?? res.result?.postings ?? [];
      postings.push(...page);
      if (!(res.has_next ?? res.result?.has_next ?? page.length === limit)) break;
    }
    return postings;
  }

  async listFboPostings(params: {
    since: Date;
    to: Date;
    limit?: number;
  }): Promise<OzonPostingItem[]> {
    const limit = Math.min(Math.max(params.limit ?? 1000, 1), 1000);
    const postings: OzonPostingItem[] = [];
    for (let offset = 0; offset < 100_000; offset += limit) {
      const res = await this.request<{ result?: OzonPostingItem[] | { postings?: OzonPostingItem[] } }>(
        "/v2/posting/fbo/list",
        {
        dir: "ASC",
        filter: {
          since: params.since.toISOString(),
          to: params.to.toISOString(),
        },
        limit,
        offset,
        with: {
          analytics_data: false,
          financial_data: true,
        },
        },
      );
      const page = Array.isArray(res.result) ? res.result : res.result?.postings ?? [];
      postings.push(...page);
      if (page.length < limit) break;
    }
    return postings;
  }

  async listFinanceTransactions(
    payload: OzonFinanceTransactionListRequest,
  ): Promise<OzonFinanceTransactionListResult> {
    const res = await this.request<
      OzonFinanceTransactionListResult | { result: OzonFinanceTransactionListResult }
    >("/v3/finance/transaction/list", payload);
    return unwrapOzonResult(res);
  }

  async listActions(): Promise<OzonAction[]> {
    const res = await this.request<OzonAction[] | { result: OzonAction[] }>(
      "/v1/actions",
      undefined,
      "GET",
    );
    return unwrapOzonResult(res);
  }

  async listActionCandidates(
    payload: OzonActionProductsRequest,
  ): Promise<OzonActionProductsResult> {
    const res = await this.request<
      OzonActionProductsResult | { result: OzonActionProductsResult }
    >("/v1/actions/candidates", payload);
    return unwrapOzonResult(res);
  }

  async listActionProducts(
    payload: OzonActionProductsRequest,
  ): Promise<OzonActionProductsResult> {
    const res = await this.request<
      OzonActionProductsResult | { result: OzonActionProductsResult }
    >("/v1/actions/products", payload);
    return unwrapOzonResult(res);
  }

  async activateActionProducts(
    payload: OzonActivateActionProductsRequest,
  ): Promise<OzonActivateActionProductsResult> {
    const res = await this.mutationRequest<
      OzonActivateActionProductsResult | { result: OzonActivateActionProductsResult }
    >("/v1/actions/products/activate", payload);
    return unwrapOzonResult(res);
  }
}
