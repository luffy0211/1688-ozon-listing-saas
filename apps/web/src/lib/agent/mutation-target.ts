type ProductIdentity = { offerId: string | null; productId: string | null };

export function mutationTarget(
  requested: Partial<ProductIdentity>,
  products: ProductIdentity[],
  fallback: ProductIdentity | null,
): ProductIdentity {
  const offerId = requested.offerId || null;
  const productId = requested.productId || null;
  if (!offerId && !productId) return fallback ?? { offerId: null, productId: null };
  const product = products.find((item) => offerId ? item.offerId === offerId : item.productId === productId);
  if (product && productId && product.productId !== productId) throw new Error("product_identity_mismatch");
  return { offerId: offerId ?? product?.offerId ?? null, productId: productId ?? product?.productId ?? null };
}
