import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageOptions = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  forcePathStyle?: boolean;
};

function fromEnv(): StorageOptions {
  return {
    endpoint: process.env.S3_ENDPOINT ?? "http://minio:9000",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "listing-assets",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  };
}

export type StoredObject = { key: string; publicUrl: string };

/**
 * S3/MinIO 对象存储。生成结果图片下载到本系统对象存储，
 * 不直接长期依赖象寄 URL。
 */
export class StorageClient {
  private readonly client: S3Client;
  private readonly options: StorageOptions;

  constructor(options: Partial<StorageOptions> = {}) {
    this.options = { ...fromEnv(), ...options };
    this.client = new S3Client({
      endpoint: this.options.endpoint,
      region: this.options.region,
      credentials: {
        accessKeyId: this.options.accessKeyId,
        secretAccessKey: this.options.secretAccessKey,
      },
      forcePathStyle: this.options.forcePathStyle ?? true,
    });
  }

  async put(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, publicUrl: this.getPublicUrl(key) };
  }

  /** 下载远程 URL 并存入对象存储。 */
  async putFromUrl(
    url: string,
    key: string,
    contentType?: string,
  ): Promise<StoredObject> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`下载 ${url} 失败: ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return this.put(key, buf, contentType ?? res.headers.get("content-type") ?? undefined);
  }

  getPublicUrl(key: string): string {
    const base = this.options.publicBaseUrl?.replace(/\/$/, "");
    if (base) return `${base}/${key}`;
    return `${this.options.endpoint.replace(/\/$/, "")}/${this.options.bucket}/${key}`;
  }

  async presignedGetUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
