import type { CookieRecord, QrCodeSession } from "./types";
import { cookieHeader } from "./cookie";

const QR_HOST = "https://qrlogin.taobao.com/qrcodelogin";

const PC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function isLoginHost(hostname: string): boolean {
  const h = (hostname ?? "").toLowerCase();
  return (
    h === "taobao.com" ||
    h.endsWith(".taobao.com") ||
    h === "1688.com" ||
    h.endsWith(".1688.com") ||
    h === "tmall.com" ||
    h.endsWith(".tmall.com") ||
    h === "alicdn.com" ||
    h.endsWith(".alicdn.com")
  );
}

function collectSetCookie(res: Response, into: CookieRecord): void {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [];
  const legacy = res.headers.get("set-cookie");
  const all = setCookies.length > 0 ? setCookies : legacy ? [legacy] : [];
  for (const sc of all) {
    const pair = sc.split(";")[0];
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name && value) into[name] = value;
  }
}

export async function createQrCode(): Promise<
  QrCodeSession & { adToken: string; qrCookies: CookieRecord }
> {
  const res = await fetch(
    `${QR_HOST}/generateQRCode4Login.do?appName=taobao&from=pc`,
    {
      headers: {
        "User-Agent": PC_UA,
        Referer: "https://login.taobao.com/",
      },
      redirect: "follow",
    },
  );

  const qrCookies: CookieRecord = {};
  collectSetCookie(res, qrCookies);

  if (!res.ok) throw new Error(`生成二维码失败 HTTP ${res.status}`);
  const j = (await res.json()) as {
    success?: boolean;
    lgToken?: string;
    adToken?: string;
    url?: string;
    message?: string;
  };
  if (!j.lgToken || !j.url) {
    throw new Error(`生成二维码失败 ${j.message ?? JSON.stringify(j)}`);
  }
  return {
    lgToken: j.lgToken,
    adToken: j.adToken ?? "",
    url: j.url,
    qrCookies,
  };
}

export type QrPollResult =
  | { status: "pending"; code?: string; message?: string }
  | { status: "scanned"; code?: string; message?: string }
  | { status: "success"; url: string; code?: string; message?: string }
  | { status: "expired"; code?: string; message?: string };

export async function pollQrCode(
  lgToken: string,
  adToken = "",
  qrCookies: CookieRecord = {},
): Promise<QrPollResult> {
  const params = new URLSearchParams({ lgToken });
  if (adToken) params.set("adToken", adToken);

  const headers: Record<string, string> = {
    "User-Agent": PC_UA,
    Referer: "https://login.taobao.com/",
  };
  if (Object.keys(qrCookies).length > 0) {
    headers.Cookie = cookieHeader(qrCookies);
  }

  const res = await fetch(`${QR_HOST}/qrcodeLoginCheck.do?${params}`, {
    headers,
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`轮询扫码状态失败 HTTP ${res.status}`);

  const j = (await res.json()) as {
    code?: string | number;
    message?: string;
    url?: string;
  };
  const code = String(j.code ?? "");
  if (code === "10000") return { status: "pending", code, message: j.message };
  if (code === "10001") return { status: "scanned", code, message: j.message };
  if (code === "10006" || code === "10004") {
    return { status: "expired", code, message: j.message };
  }
  if ((code === "10002" || code === "0") && j.url) {
    return { status: "success", url: j.url, code, message: j.message };
  }
  return { status: "pending", code, message: j.message };
}

export async function exchangeCookies(
  url: string,
  initialCookies: CookieRecord = {},
): Promise<CookieRecord> {
  const cookies: CookieRecord = { ...initialCookies };
  let current: string | null = url;
  const seen = new Set<string>();
  const baseHeaders = {
    "User-Agent": PC_UA,
    Referer: "https://login.taobao.com/",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };

  for (let i = 0; i < 8 && current; i++) {
    if (seen.has(current)) break;
    seen.add(current);

    let currentHost: string;
    try {
      currentHost = new URL(current).hostname;
    } catch {
      break;
    }
    if (!isLoginHost(currentHost)) break;

    const headers: Record<string, string> = { ...baseHeaders };
    if (Object.keys(cookies).length > 0) {
      headers.Cookie = cookieHeader(cookies);
    }
    const res: Response = await fetch(current, {
      headers,
      redirect: "manual",
    });
    collectSetCookie(res, cookies);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) break;
      let next: string;
      try {
        next = new URL(loc, current).toString();
      } catch {
        break;
      }
      if (!isLoginHost(new URL(next).hostname)) break;
      current = next;
      continue;
    }
    break;
  }

  return cookies;
}
