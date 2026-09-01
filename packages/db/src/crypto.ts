import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM 加密工具。
 * 密钥来自 APP_ENCRYPTION_KEY（base64 或 hex 编码的 32 字节）。
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("APP_ENCRYPTION_KEY 未配置");
  }
  const isHex = raw.length === 64 && /^[0-9a-f]+$/i.test(raw);
  const decoded = Buffer.from(raw, isHex ? "hex" : "base64");
  if (decoded.length < 32) {
    throw new Error("APP_ENCRYPTION_KEY 长度不足，需要 32 字节");
  }
  return Buffer.from(decoded.subarray(0, 32));
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const key = deriveKey();
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("加密数据格式非法");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** 脱敏：仅保留前 4 后 4，中间用星号。 */
export function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}
