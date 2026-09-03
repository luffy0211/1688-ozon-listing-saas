type ProductImageAsset = {
  kind: string;
  publicUrl?: string | null;
  sourceUrl?: string | null;
};

const IMAGE_KIND_PRIORITY = ["main_image", "sku_image", "detail_image"];

export function preferredProductImageUrl(assets: ProductImageAsset[]): string | null {
  for (const kind of IMAGE_KIND_PRIORITY) {
    const asset = assets.find((item) => item.kind === kind && (item.publicUrl || item.sourceUrl));
    if (asset) return asset.publicUrl ?? asset.sourceUrl ?? null;
  }
  const asset = assets.find((item) => item.publicUrl || item.sourceUrl);
  return asset?.publicUrl ?? asset?.sourceUrl ?? null;
}
