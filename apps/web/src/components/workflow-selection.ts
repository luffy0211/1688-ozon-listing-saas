export type WorkflowSelectableProduct = {
  latestDraftStatus: string | null;
  latestJobStatus: string | null;
};

export type WorkflowProgressJob = {
  status: string;
  steps?: Array<{ status: string }>;
};

const finishedStepStatuses = new Set(["SUCCEEDED", "FAILED", "SKIPPED"]);

export function isWorkflowProductSelectable(product: WorkflowSelectableProduct) {
  return product.latestDraftStatus !== "SUBMITTED"
    && product.latestJobStatus !== "PENDING"
    && product.latestJobStatus !== "RUNNING";
}

export function getWorkflowSelectedProducts<T extends WorkflowSelectableProduct & { id: string }>(
  products: T[],
  selectedIds: Set<string>,
) {
  return products.filter((product) => selectedIds.has(product.id) && isWorkflowProductSelectable(product));
}

export function isWorkflowJobTerminal(job: Pick<WorkflowProgressJob, "status">) {
  return job.status === "SUCCEEDED" || job.status === "FAILED";
}

export function getWorkflowJobProgress(job: WorkflowProgressJob) {
  const steps = job.steps ?? [];
  if (steps.length === 0) return job.status === "SUCCEEDED" ? 100 : 0;
  return Math.round((steps.filter((step) => finishedStepStatuses.has(step.status)).length / steps.length) * 100);
}

export function getWorkflowBatchProgress(jobs: WorkflowProgressJob[]) {
  if (jobs.length === 0) return 0;
  return Math.round(jobs.reduce((sum, job) => sum + getWorkflowJobProgress(job), 0) / jobs.length);
}
