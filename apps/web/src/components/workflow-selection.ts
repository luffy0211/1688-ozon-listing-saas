export type WorkflowSelectableProduct = {
  latestDraftStatus: string | null;
  latestJobStatus: string | null;
};

export function isWorkflowProductSelectable(product: WorkflowSelectableProduct) {
  return product.latestDraftStatus !== "SUBMITTED" && product.latestJobStatus !== "RUNNING";
}

export function getWorkflowSelectedProducts<T extends WorkflowSelectableProduct & { id: string }>(
  products: T[],
  selectedIds: Set<string>,
) {
  return products.filter((product) => selectedIds.has(product.id) && isWorkflowProductSelectable(product));
}
