import { createHash } from "node:crypto";
import type {
  DesignTaskResult,
  GenerateOptions,
  PollOptions,
  SnapshotOptions,
  TranslateOptions,
} from "./types";

export type XiangjiClientOptions = {
  apiKey: string;
  baseUrl?: string;
  /** 本地联调用：true 时不发真实请求，返回假数据。 */
  mock?: boolean;
  /** 只控制文本翻译，未传时回退到 mock。 */
  textMock?: boolean;
  /** 只控制 PDP 图片流程，未传时回退到 mock。 */
  pdpMock?: boolean;
  authMode?: "x-api-key" | "legacy";
  legacy?: {
    userKey?: string;
    textTransKey?: string;
  };
};

function resolveMock(opt?: boolean): boolean {
  if (typeof opt === "boolean") return opt;
  return process.env.XIANGJI_MOCK === "true";
}

function resolveScopedMock(scoped?: boolean, fallback?: boolean, envName?: string): boolean {
  if (typeof scoped === "boolean") return scoped;
  if (envName && process.env[envName]) return process.env[envName] === "true";
  return resolveMock(fallback);
}

function mockId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function mockTranslate(texts: string[], opts: TranslateOptions): string[] {
  const target = (opts.targetLanguage ?? "RUS").toUpperCase();
  return texts.map((_, i) =>
    target === "RUS" ? `Тестовый перевод ${i + 1}` : `Mock translation ${i + 1}`,
  );
}

const DEFAULT_BASE = "https://api.tosoiot.com";
const LEGACY_BASE = "http://api.tosoiot.com";

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function legacyTextType(vendor?: string): number | undefined {
  const normalized = vendor?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "aliyun" || normalized === "ali") return 0;
  if (normalized === "google") return 1;
  if (normalized === "papago") return 2;
  if (normalized === "baidu") return 3;
  if (normalized === "deepl") return 4;
  if (normalized === "chatgpt" || normalized === "openai") return 5;
  if (normalized === "googlellm") return 6;
  return undefined;
}

/**
 * 象寄开放平台 client。
 * 覆盖：文本翻译、PDP 详情图（design/snapshot/generate）、批量图片翻译（备用）。
 */
export class XiangjiClient {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly mock: boolean;
  readonly textMock: boolean;
  readonly pdpMock: boolean;
  readonly authMode: "x-api-key" | "legacy";
  readonly legacyUserKey?: string;
  readonly legacyTextTransKey?: string;

  constructor(options: XiangjiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? process.env.XIANGJI_API_BASE ?? DEFAULT_BASE;
    this.mock = resolveMock(options.mock);
    this.textMock = resolveScopedMock(options.textMock, options.mock, "XIANGJI_TEXT_MOCK");
    this.pdpMock = resolveScopedMock(options.pdpMock, options.mock, "XIANGJI_PDP_MOCK");
    this.authMode =
      options.authMode ??
      (process.env.XIANGJI_AUTH_MODE === "legacy" ? "legacy" : "x-api-key");
    this.legacyUserKey = options.legacy?.userKey ?? process.env.XIANGJI_USER_KEY;
    this.legacyTextTransKey =
      options.legacy?.textTransKey ?? process.env.XIANGJI_TEXT_TRANS_KEY;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`象寄 API ${path} 返回 ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  private async legacyTextTranslate(text: string, opts: TranslateOptions): Promise<string> {
    const userKey = this.legacyUserKey;
    const textTransKey = this.legacyTextTransKey;
    if (!userKey || !textTransKey) {
      throw new Error("象寄旧版文本翻译缺少 UserKey 或 TextTransKey");
    }

    const commitTime = Math.floor(Date.now() / 1000).toString();
    const params = new URLSearchParams({
      Action: "GetTextTranslate",
      SourceLanguage: opts.sourceLanguage ?? "CHS",
      TargetLanguage: opts.targetLanguage ?? "RUS",
      Text: text,
      TextTransKey: textTransKey,
      CommitTime: commitTime,
      Sign: md5(`${commitTime}_${userKey}_${textTransKey}`),
    });
    const type = legacyTextType(opts.vendor);
    if (typeof type === "number") params.set("Type", String(type));

    const res = await fetch(LEGACY_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: params.toString(),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`象寄旧版文本翻译返回 ${res.status}: ${body}`);
    }

    let json: {
      Code?: number;
      Message?: string;
      Data?: { Text?: string };
    };
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`象寄旧版文本翻译返回非 JSON: ${body.slice(0, 200)}`);
    }
    if (json.Code !== 200) {
      throw new Error(`象寄旧版文本翻译失败: ${json.Message ?? json.Code}`);
    }
    const translated = json.Data?.Text;
    if (!translated) throw new Error("象寄旧版文本翻译未返回译文");
    return translated;
  }

  /** 文本翻译：返回与输入 texts 一一对应的译文。 */
  async translateText(
    texts: string[],
    opts: TranslateOptions = {},
  ): Promise<string[]> {
    if (this.textMock) return mockTranslate(texts, opts);

    if (this.authMode === "legacy") {
      const translated: string[] = [];
      for (const text of texts) {
        translated.push(await this.legacyTextTranslate(text, opts));
      }
      return translated;
    }

    const body = {
      texts,
      source_language: opts.sourceLanguage ?? "CHS",
      target_language: opts.targetLanguage ?? "RUS",
      translation_vendor: opts.vendor ?? "DeepL",
    };
    const res = await this.post<{
      data?: { texts?: string[] } | null;
      texts?: string[];
      result?: string[];
    }>("/task/v1/text/translate", body);

    const translated =
      res.data?.texts ?? res.texts ?? res.result ?? [];
    if (!Array.isArray(translated) || translated.length !== texts.length) {
      throw new Error("象寄文本翻译返回结果数量不匹配");
    }
    return translated as string[];
  }

  /** 1. 创建设计任务。 */
  async createDesign(link: string): Promise<{ taskId: string }> {
    if (this.pdpMock) return { taskId: mockId("task") };
    const res = await this.post<{ data?: { task_id?: string } }>(
      "/task/v1/detail-page/design",
      { link },
    );
    const taskId = res.data?.task_id;
    if (!taskId) throw new Error("象寄创建设计任务未返回 task_id");
    return { taskId };
  }

  /** 2. 查询设计任务。 */
  async queryDesign(taskIds: string[]): Promise<DesignTaskResult[]> {
    if (this.pdpMock) {
      return taskIds.map((taskId) => ({
        taskId,
        status: "success",
        gcid: mockId("gcid"),
      }));
    }
    const res = await this.post<{ data?: { list?: DesignTaskResult[] } }>(
      "/task/v1/detail-page/design/result",
      { task_ids: taskIds },
    );
    return (res.data?.list ?? []).map((item) => ({
      ...item,
      taskId: item.taskId ?? (item as Record<string, unknown>).task_id,
    }));
  }

  /** 3. 创建预览。 */
  async createSnapshot(
    opts: SnapshotOptions,
  ): Promise<{ gcid: string; requestId: string }> {
    if (this.pdpMock) {
      return { gcid: mockId("gcid"), requestId: mockId("req") };
    }
    const res = await this.post<{ data?: { gcid?: string; request_id?: string } }>(
      "/exec/v1/detail-page/snapshot",
      {
        task_id: opts.taskId,
        platform: opts.platform ?? "Ozon",
        region: opts.region ?? "RU",
        language: opts.language ?? "RUS",
        aspect_ratio: opts.aspectRatio ?? "auto",
        count: opts.count ?? 8,
      },
    );
    const gcid = res.data?.gcid;
    if (!gcid) throw new Error("象寄创建预览未返回 gcid");
    return { gcid, requestId: res.data?.request_id ?? "" };
  }

  /** 4. 创建最终图片。 */
  async generateImages(opts: GenerateOptions): Promise<{ requestId: string }> {
    if (this.pdpMock) return { requestId: opts.requestId || mockId("req") };
    const res = await this.post<{ data?: { request_id?: string } }>(
      "/exec/v1/detail-page/generate",
      {
        task_id: opts.taskId,
        gcid: opts.gcid,
        request_id: opts.requestId,
        resolution: opts.resolution ?? "1K",
      },
    );
    return { requestId: res.data?.request_id ?? opts.requestId };
  }

  /** 5. 查询生成结果：返回结果图片 URL 列表。 */
  async queryGenerateResult(
    taskId: string,
    requestIds: string[],
  ): Promise<string[]> {
    if (this.pdpMock) {
      return requestIds.map(
        (_, i) => `https://mock.xiangji.local/${taskId}/detail-${i + 1}.jpg`,
      );
    }
    const res = await this.post<{
      data?: { list?: Array<{ request_id?: string; images?: string[] }> };
    }>(
      "/exec/v1/detail-page/generate/result",
      { task_id: taskId, request_ids: requestIds },
    );
    const urls: string[] = [];
    for (const item of res.data?.list ?? []) {
      if (Array.isArray(item.images)) urls.push(...item.images);
    }
    return urls;
  }

  /** 备用：批量图片翻译（只翻译原图文字，不重做排版）。 */
  async imageTranslateBatch(urls: string[]): Promise<string[]> {
    if (this.pdpMock) return urls;
    const res = await this.post<{ data?: { images?: string[] }; result?: string[] }>(
      "",
      {
        Action: "GetImageTranslateBatch",
        SourceLanguage: "CHS",
        TargetLanguage: "RUS",
        Urls: urls,
      },
    );
    return (res.data?.images ?? res.result ?? []) as string[];
  }

  /** 轮询辅助：按默认 10s 间隔、最多 30 次，直到谓词返回非空。 */
  async poll<T>(
    fn: () => Promise<T | null | undefined>,
    opts: PollOptions = {},
  ): Promise<T> {
    const intervalMs = opts.intervalMs ?? 10_000;
    const maxAttempts = opts.maxAttempts ?? 30;
    for (let i = 0; i < maxAttempts; i++) {
      const result = await fn();
      if (result) return result;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error("象寄任务轮询超时");
  }
}
