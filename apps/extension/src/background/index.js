function offerIdFromUrl(url = "") {
  return url.match(/offer\/(\d+)\.html/)?.[1] || url.match(/[?&]offerId=(\d+)/)?.[1] || "";
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value = "") {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }
  return "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function absoluteCdn(url = "") {
  const value = decodeHtml(url).trim();
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return "";
}

function collectImages(html, fallbackImage) {
  const candidates = [];
  const imagePatterns = [
    /https?:\\?\/\\?\/[^"'\s<>]+?alicdn\.com[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)/gi,
    /\/\/[^"'\s<>]+?alicdn\.com[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)/gi,
  ];

  for (const pattern of imagePatterns) {
    for (const match of html.matchAll(pattern)) {
      candidates.push(absoluteCdn(match[0]));
    }
  }
  if (fallbackImage) candidates.unshift(fallbackImage);

  return unique(candidates)
    .filter((url) => /alicdn\.com/.test(url))
    .slice(0, 30);
}

function extractJsonArray(html, key) {
  const tag = `"${key}":`;
  const start = html.indexOf(tag);
  if (start === -1) return [];
  const arrayStart = html.indexOf("[", start);
  if (arrayStart === -1) return [];

  let depth = 0;
  for (let i = arrayStart; i < html.length; i++) {
    const ch = html[i];
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(decodeHtml(html.slice(arrayStart, i + 1)));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

function collectProperties(html) {
  const out = [];
  for (const item of [...extractJsonArray(html, "decisionCpv"), ...extractJsonArray(html, "normalCpv")]) {
    if (!item || typeof item !== "object") continue;
    const name = cleanText(String(item.name || ""));
    const values = Array.isArray(item.values)
      ? item.values.map((value) => cleanText(String(value))).filter(Boolean)
      : [];
    if (name && values.length > 0) out.push({ name, value: values.join("、") });
  }
  return out.slice(0, 80);
}

function parsePrice(text) {
  const raw = cleanText(text).match(/\d+(?:\.\d+)?/)?.[0] || "";
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function parseProductHtml(html, item, shop) {
  const title =
    firstMatch(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
      /"subject"\s*:\s*"([^"]+)"/i,
      /"title"\s*:\s*"([^"]+)"/i,
    ]) ||
    item.title ||
    item.offerId;

  const images = collectImages(html, item.imageUrl);
  const price =
    parsePrice(firstMatch(html, [/"price"\s*:\s*"([^"]+)"/i, /"priceDisplay"\s*:\s*"([^"]+)"/i])) ||
    parsePrice(item.priceText);

  const shopName =
    firstMatch(html, [
      /"sellerLoginId"\s*:\s*"([^"]+)"/i,
      /"companyName"\s*:\s*"([^"]+)"/i,
      /"shopName"\s*:\s*"([^"]+)"/i,
    ]) ||
    shop.shopName ||
    "未知店铺";

  const shopUrl =
    firstMatch(html, [/"winportUrl"\s*:\s*"([^"]+)"/i]) ||
    shop.shopUrl ||
    new URL(item.url).origin;

  return {
    source: "1688",
    sourceUrl: item.url,
    offerId: item.offerId,
    capturedAt: new Date().toISOString(),
    shop: {
      shopName,
      shopUrl,
    },
    title,
    categoryPath: [],
    priceTiers: price > 0 ? [{ minQuantity: 1, priceCny: price }] : [],
    properties: collectProperties(html),
    skus: [],
    mainImages: images.slice(0, 8),
    detailImages: images.slice(8, 30),
    descriptionText: title,
  };
}

async function fetchProduct(item, shop) {
  const res = await fetch(item.url, {
    credentials: "include",
    headers: {
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`商品 ${item.offerId} 请求失败：HTTP ${res.status}`);
  const html = await res.text();
  return parseProductHtml(html, item, shop);
}

async function importProducts(apiBase, authToken, products) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${apiBase}/api/v1/extension/import-1688-products`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ products }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function captureShopToPool(message, sendResponse) {
  const tabId = message.tabId;
  const limit = Math.max(1, Math.min(200, Number(message.limit || 50)));
  const apiBase = String(message.apiBase || "http://localhost:3000").replace(/\/$/, "");
  const authToken = String(message.authToken || "");

  const shop = await chrome.tabs.sendMessage(tabId, {
    type: "CAPTURE_SHOP_LINKS",
    limit,
  });
  const items = Array.isArray(shop?.products) ? shop.products.slice(0, limit) : [];
  if (items.length === 0) {
    sendResponse({
      ok: false,
      status: 0,
      error: "当前页面没有找到 1688 商品链接，请打开店铺的全部商品或新品页面。",
    });
    return;
  }

  const products = [];
  const failures = [];
  for (const item of items) {
    try {
      if (!item.offerId) item.offerId = offerIdFromUrl(item.url);
      products.push(await fetchProduct(item, shop));
    } catch (error) {
      failures.push({
        offerId: item.offerId,
        title: item.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (products.length === 0) {
    sendResponse({
      ok: false,
      status: 0,
      error: failures[0]?.error || "没有成功采集到商品详情",
    });
    return;
  }

  const imported = await importProducts(apiBase, authToken, products);
  sendResponse({
    ...imported,
    collected: products.length,
    captureFailures: failures,
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "CAPTURE_SHOP_TO_POOL") return false;
  captureShopToPool(message, sendResponse).catch((error) => {
    sendResponse({
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return true;
});
