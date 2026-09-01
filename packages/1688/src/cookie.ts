import type { CookieLike, CookieRecord } from "./types";

export function toCookieRecord(cookies: CookieLike[]): CookieRecord {
  const out: CookieRecord = {};
  for (const c of cookies) {
    if (c && c.name && c.value) out[c.name] = c.value;
  }
  return out;
}

export function cookieHeader(cookies: CookieRecord): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export function parseCookieHeader(input: string): CookieRecord {
  const out: CookieRecord = {};
  for (const part of input.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (name && value) out[name] = value;
  }
  return out;
}

export function hasLoginCookies(cookies: CookieRecord): boolean {
  const markers = ["unb", "cookie2", "sgcookie", "_tb_token_", "_m_h5_tk", "aui", "cnaui", "atpsida"];
  return markers.some((m) => {
    const v = cookies[m];
    return v && v !== "0" && v !== "-" && v !== "undefined";
  });
}
