type ProductImageAsset = {
  kind: string;
  publicUrl?: string | null;
  sourceUrl?: string | null;
};

const IMAGE_KIND_PRIORITY = ["main_image", "sku_image", "detail_image"];

export function isTrustedProductImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "ir.ozone.ru" || host === "alicdn.com" || host.endsWith(".alicdn.com");
}

export function displayProductImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && isTrustedProductImageHost(parsed.hostname)) {
      return `/api/v1/image-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return url;
  }
  return url;
}

export function preferredProductImageUrl(assets: ProductImageAsset[]): string | null {
  for (const kind of IMAGE_KIND_PRIORITY) {
    const asset = assets.find((item) => item.kind === kind && (item.publicUrl || item.sourceUrl));
    const url = asset?.publicUrl ?? asset?.sourceUrl;
    if (url) return displayProductImageUrl(url);
  }
  const asset = assets.find((item) => item.publicUrl || item.sourceUrl);
  const url = asset?.publicUrl ?? asset?.sourceUrl;
  return url ? displayProductImageUrl(url) : null;
}
