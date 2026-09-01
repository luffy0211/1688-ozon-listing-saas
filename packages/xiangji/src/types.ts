/** 象寄开放平台客户端类型。 */

export type TranslateOptions = {
  sourceLanguage?: string; // 默认 CHS
  targetLanguage?: string; // 默认 RUS
  vendor?: string; // 默认 DeepL
};

export type DesignTaskResult = {
  taskId: string;
  status?: string;
  gcid?: string;
  [key: string]: unknown;
};

export type SnapshotOptions = {
  taskId: string;
  platform?: string; // 默认 Ozon
  region?: string; // 默认 RU
  language?: string; // 默认 RUS
  aspectRatio?: string; // 默认 auto
  count?: number; // 默认 8
};

export type GenerateOptions = {
  taskId: string;
  gcid: string;
  requestId: string;
  resolution?: string; // 默认 1K
};

export type PollOptions = {
  intervalMs?: number; // 默认 10000
  maxAttempts?: number; // 默认 30
};
