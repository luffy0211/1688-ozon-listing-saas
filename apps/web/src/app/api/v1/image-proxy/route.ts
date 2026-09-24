import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fail, unauthorized } from "@/lib/api";
import { isTrustedProductImageHost } from "@/lib/product-image";
import { sessionFromRequest } from "@/lib/request-session";

const MAX_IMAGE_BYTES = 10_000_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

function trustedImageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!isTrustedProductImageHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function limitedBody(response: Response): Promise<ArrayBuffer | null> {
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();

  const target = trustedImageUrl(req.nextUrl.searchParams.get("url") ?? "");
  if (!target) return fail("validation_error", "图片地址不允许代理", [], 400);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Referer: target.hostname === "ir.ozone.ru" ? "https://www.ozon.ru/" : "https://www.1688.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      },
    });
  } catch {
    return fail("upstream_error", "图片读取失败", [], 502);
  }
  if (!upstream.ok) return fail("upstream_error", "图片读取失败", [], 502);

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!ALLOWED_IMAGE_TYPES.has(contentType.split(";").at(0)?.trim().toLowerCase() ?? "")) {
    return fail("upstream_error", "上游返回的不是支持的图片格式", [], 502);
  }
  let body: ArrayBuffer | null;
  try {
    body = await limitedBody(upstream);
  } catch {
    return fail("upstream_error", "图片读取失败", [], 502);
  }
  if (!body) return fail("upstream_error", "图片过大或内容为空", [], 502);

  return new NextResponse(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
