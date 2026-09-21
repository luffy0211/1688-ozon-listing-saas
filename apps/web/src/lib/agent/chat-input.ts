const OZON_URL_RE = /https?:\/\/(?:www\.)?ozon\.(?:ru|com)\/[^\s<>"')，。；、]+/gi;

const OFFER_ID_PATTERNS = [
  /(?:货号|商品编号|自家商品)\s*(?:是|为|:|=|：)?\s*([A-Za-z0-9._-]{2,80})/i,
  /\boffer[_\s-]*id\s*[:=：]?\s*([A-Za-z0-9._-]{2,80})/i,
  /\bsku\s*[:=：]?\s*([A-Za-z0-9._-]{2,80})/i,
  /\b([A-Z]\d{6,}[A-Za-z0-9._-]*-[A-Za-z0-9._-]+)\b/,
];

function cleanUrl(value: string) {
  return value.replace(/[)\]}>，。；、,.]+$/g, "");
}

export function extractOzonUrls(text: string) {
  return [...new Set((text.match(OZON_URL_RE) ?? []).map(cleanUrl))];
}

export function extractOfferId(text: string) {
  for (const pattern of OFFER_ID_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
