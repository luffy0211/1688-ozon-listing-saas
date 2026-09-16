import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fail, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

function alicdnImageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (host !== "alicdn.com" && !host.endsWith(".alicdn.com")) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();

  const target = alicdnImageUrl(req.nextUrl.searchParams.get("url") ?? "");
  if (!target) return fail("validation_error", "图片地址不允许代理", [], 400);

  const upstream = await fetch(target, {
    headers: {
      Referer: "https://www.1688.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
  });
  if (!upstream.ok) return fail("upstream_error", "图片读取失败", [], 502);

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return fail("upstream_error", "上游返回的不是图片", [], 502);

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=86400",
    },
  });
}
