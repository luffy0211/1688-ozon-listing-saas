function text(selector) {
  return document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function absoluteUrl(url) {
  try {
    return new URL(url, location.href).toString();
  } catch {
    return "";
  }
}

function offerIdFromUrl(url = location.href) {
  return url.match(/offer\/(\d+)\.html/)?.[1] || url.match(/[?&]offerId=(\d+)/)?.[1] || "";
}

function uniqueByOfferId(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item.offerId || seen.has(item.offerId)) continue;
    seen.add(item.offerId);
    out.push(item);
  }
  return out;
}

function shopNameFromPage() {
  return (
    text("[class*='shop-name']") ||
    text("[class*='company']") ||
    text("h1") ||
    document.title.replace(/[-_|].*$/, "").trim() ||
    "未知店铺"
  );
}

function imageFromCard(card) {
  const image = card?.querySelector("img");
  const src =
    image?.currentSrc ||
    image?.src ||
    image?.getAttribute("data-src") ||
    image?.getAttribute("data-lazy-src") ||
    "";
  return absoluteUrl(src);
}

function titleFromCard(link, card) {
  return (
    link.getAttribute("title") ||
    card?.querySelector("[title]")?.getAttribute("title") ||
    link.textContent ||
    card?.textContent ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function priceFromCard(card) {
  const content = card?.textContent?.replace(/\s+/g, " ") || "";
  return content.match(/(?:¥|￥)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*元/)?.[0] || "";
}

function scanShopLinks(limit) {
  const anchors = [...document.querySelectorAll("a[href*='offer/'][href*='.html']")];
  return uniqueByOfferId(
    anchors.map((link) => {
      const url = absoluteUrl(link.getAttribute("href") || "");
      const card = link.closest("li, div");
      return {
        offerId: offerIdFromUrl(url),
        title: titleFromCard(link, card),
        url,
        imageUrl: imageFromCard(card),
        priceText: priceFromCard(card),
      };
    }),
  ).slice(0, limit);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureShopLinks(limit) {
  let products = scanShopLinks(limit);
  let stableRounds = 0;

  for (let i = 0; i < 12 && products.length < limit; i++) {
    const before = products.length;
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
    await delay(700);
    products = scanShopLinks(limit);
    stableRounds = products.length === before ? stableRounds + 1 : 0;
    if (stableRounds >= 3) break;
  }

  return {
    source: "1688",
    shopUrl: location.href,
    shopName: shopNameFromPage(),
    capturedAt: new Date().toISOString(),
    products,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_SHOP_LINKS") {
    captureShopLinks(Number(message.limit || 50)).then(sendResponse);
    return true;
  }
  return false;
});
