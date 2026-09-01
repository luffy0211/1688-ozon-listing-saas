import { createHash } from "node:crypto";
import type { CookieRecord } from "./types";
import { cookieHeader } from "./cookie";

export const APP_KEY = "12574478";
export const MTOP_HOST = "https://h5api.m.1688.com";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

export function mtopToken(cookies: CookieRecord): string {
  const tk = cookies["_m_h5_tk"] ?? "";
  const i = tk.indexOf("_");
  return i === -1 ? tk : tk.slice(0, i);
}

export function makeMtopSign(token: string, ts: number, data: string): string {
  return createHash("md5").update(`${token}&${ts}&${APP_KEY}&${data}`).digest("hex");
}

export function parseJsonp(text: string): unknown {
  const t = text.trim();
  if (t.startsWith("{")) {
    try {
      return JSON.parse(t);
    } catch {
      /* fallthrough */
    }
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      /* fallthrough */
    }
  }
  return t;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function applySetCookie(cookies: CookieRecord, setCookie: string | null) {
  if (!setCookie) return false;
  let changed = false;
  for (const item of setCookie.split(/,(?=\s*[^;,=\s]+=[^;,]+)/)) {
    const first = item.split(";")[0]?.trim();
    if (!first) continue;
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq);
    const value = first.slice(eq + 1);
    if (name && value) {
      cookies[name] = value;
      changed = true;
    }
  }
  return changed;
}

function isSuccess(parsed: Record<string, unknown>) {
  const ret = parsed["ret"];
  return Array.isArray(ret) && ret.length > 0 && String(ret[0]).startsWith("SUCCESS");
}

function needsTokenRetry(parsed: Record<string, unknown>) {
  const ret = parsed["ret"];
  return Array.isArray(ret) && ret.some((item) => /TOKEN|SIGN|FAIL_SYS/i.test(String(item)));
}

async function requestMtop(
  cookies: CookieRecord,
  api: string,
  dataStr: string,
): Promise<{ parsed: Record<string, unknown>; setCookie: string | null }> {
  const token = mtopToken(cookies);
  const ts = Date.now();
  const sign = makeMtopSign(token, ts, dataStr);

  const params = new URLSearchParams({
    jsv: "2.6.1",
    appKey: APP_KEY,
    t: String(ts),
    sign,
    v: "1.0",
    type: "jsonp",
    isSec: "0",
    timeout: "20000",
    api,
    dataType: "jsonp",
  });

  const res = await fetch(`${MTOP_HOST}/h5/${api}/1.0/?${params}`, {
    method: "POST",
    headers: {
      "User-Agent": MOBILE_UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: "https://detail.m.1688.com/",
      Cookie: cookieHeader(cookies),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ data: dataStr }),
  });

  const text = await res.text();
  return {
    parsed: asRecord(parseJsonp(text)),
    setCookie: res.headers.get("set-cookie"),
  };
}

export async function mtopPost(
  cookies: CookieRecord,
  api: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const dataStr = JSON.stringify(data);
  let lastParsed: Record<string, unknown> = {};

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await requestMtop(cookies, api, dataStr);
    lastParsed = result.parsed;
    if (isSuccess(lastParsed)) return lastParsed;

    if (attempt === 0 && needsTokenRetry(lastParsed) && applySetCookie(cookies, result.setCookie)) {
      continue;
    }
    break;
  }

  const ret = lastParsed["ret"];
  throw new Error(`mtop ${api} 失败: ${JSON.stringify(ret ?? lastParsed)}`);
}
