"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { StatusBadge, stepLabel } from "./status";
import { Button, Card, EmptyState, ProgressBar } from "./ui";
import { getWorkflowBatchProgress, getWorkflowJobProgress, isWorkflowJobTerminal } from "./workflow-selection";

export type WorkflowPublishProduct = {
  id: string;
  title: string;
  offerId: string;
};

type JobStep = {
  stepName: string;
  status: string;
  error: string | null;
};

type PublishItem = WorkflowPublishProduct & {
  jobId: string | null;
  status: string;
  steps: JobStep[];
  error: string | null;
};

const storageKey = "ozon_workflow_publish_batch";

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function requestJson(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(json.error?.message ?? "请求失败", response.status);
  return json.data;
}

function restoreItems(): PublishItem[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.offerId !== "string") return [];
      const jobId = typeof item.jobId === "string" ? item.jobId : null;
      const status = typeof item.status === "string" ? item.status : "FAILED";
      const steps = Array.isArray(item.steps)
        ? item.steps.flatMap((step) => {
            if (!step || typeof step !== "object") return [];
            const candidate = step as Record<string, unknown>;
            if (typeof candidate.stepName !== "string" || typeof candidate.status !== "string") return [];
            return [{
              stepName: candidate.stepName,
              status: candidate.status,
              error: typeof candidate.error === "string" ? candidate.error : null,
            }];
          })
        : [];
      return [{
        id: item.id,
        title: item.title,
        offerId: item.offerId,
        jobId,
        status: jobId || status === "FAILED" ? status : "PENDING",
        steps,
        error: typeof item.error === "string" ? item.error : null,
      }];
    });
  } catch {
    return [];
  }
}

function currentStepText(item: PublishItem) {
  const step = item.steps.find(({ status }) => status === "RUNNING")
    ?? item.steps.find(({ status }) => status === "FAILED")
    ?? item.steps.find(({ status }) => status === "PENDING")
    ?? item.steps[item.steps.length - 1];
  if (step) return stepLabel(step.stepName);
  return item.jobId ? "等待后台处理" : "创建上架任务";
}

export function WorkflowPublishProgress({
  products,
  onBack,
  onMonitor,
  onStarted,
  onComplete,
}: {
  products: WorkflowPublishProduct[];
  onBack: () => void;
  onMonitor: () => void;
  onStarted: () => void;
  onComplete: () => void;
}) {
  const initialProducts = useRef(products);
  const completed = useRef(false);
  const [items, setItems] = useState<PublishItem[]>([]);
  const [ready, setReady] = useState(false);
  const [pollError, setPollError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const selected = initialProducts.current;
    const batch = selected.length
      ? selected.map((product) => ({
          ...product,
          jobId: null,
          status: "PENDING",
          steps: [],
          error: null,
        }))
      : restoreItems();
    setItems(batch);
    setReady(true);
    window.sessionStorage.setItem(storageKey, JSON.stringify(batch));
    if (selected.length) onStarted();

    async function enqueue() {
      for (const product of batch.filter((item) => !item.jobId && !isWorkflowJobTerminal(item))) {
        try {
          const data = await requestJson(`/api/v1/products/${product.id}/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ autoPublish: true }),
          });
          if (!data || typeof data.jobId !== "string") throw new Error("上架任务返回数据无效");
          if (cancelled) return;
          setItems((previous) => previous.map((item) => (
            item.id === product.id ? { ...item, jobId: data.jobId, status: "PENDING" } : item
          )));
        } catch (error) {
          if (cancelled) return;
          setItems((previous) => previous.map((item) => (
            item.id === product.id
              ? { ...item, status: "FAILED", error: error instanceof Error ? error.message : String(error) }
              : item
          )));
        }
      }
    }

    void enqueue();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || items.length === 0) return;
    window.sessionStorage.setItem(storageKey, JSON.stringify(items));
  }, [items, ready]);

  const activeJobIds = useMemo(
    () => items.filter((item) => item.jobId && !isWorkflowJobTerminal(item)).map((item) => item.jobId).join(","),
    [items],
  );

  useEffect(() => {
    if (!ready || !activeJobIds) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const jobIds = activeJobIds.split(",");

    async function poll() {
      const results = await Promise.all(jobIds.map(async (jobId) => {
        try {
          const data = await requestJson(`/api/v1/jobs/${jobId}`);
          if (!data?.job || typeof data.job.status !== "string") throw new Error("任务状态返回数据无效");
          return { jobId, job: data.job, error: null, permanent: false };
        } catch (error) {
          return {
            jobId,
            job: null,
            error: error instanceof Error ? error.message : String(error),
            permanent: error instanceof RequestError && (error.status === 404 || error.status === 410),
          };
        }
      }));
      if (cancelled) return;

      const jobs = new Map(results.filter((result) => result.job).map((result) => [result.jobId, result.job]));
      setItems((previous) => previous.map((item) => {
        const result = item.jobId ? results.find((candidate) => candidate.jobId === item.jobId) : null;
        if (result?.permanent) return { ...item, status: "FAILED", error: result.error };
        const job = item.jobId ? jobs.get(item.jobId) : null;
        if (!job) return item;
        return {
          ...item,
          status: job.status,
          error: typeof job.error === "string" ? job.error : null,
          steps: Array.isArray(job.steps) ? job.steps.map((step: JobStep) => ({
            stepName: step.stepName,
            status: step.status,
            error: step.error ?? null,
          })) : [],
        };
      }));
      const errors = results.flatMap((result) => result.error ? [result.error] : []);
      setPollError(errors[0] ?? "");
      timer = setTimeout(poll, 2000);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeJobIds, ready]);

  const allDone = items.length > 0 && items.every(isWorkflowJobTerminal);
  useEffect(() => {
    if (!allDone || completed.current) return;
    completed.current = true;
    onComplete();
  }, [allDone, onComplete]);

  const progress = getWorkflowBatchProgress(items);
  const finishedCount = items.filter(isWorkflowJobTerminal).length;
  const failedCount = items.filter((item) => item.status === "FAILED").length;

  return (
    <Card>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-950">上架进度</h2>
          <p className="mt-1 text-sm text-gray-500">正在自动翻译、定价、生成 Ozon 数据并提交。</p>
        </div>
        <div className="text-sm font-medium text-gray-700">已完成 {finishedCount} / {items.length}</div>
      </div>

      {items.length ? (
        <>
          <div className="mb-5 rounded-md border border-gray-200 bg-gray-50 p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">总进度</span>
              <span className="tabular-nums text-gray-500">{progress}%</span>
            </div>
            <ProgressBar value={progress} />
          </div>

          {pollError ? (
            <div role="status" className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              状态刷新失败，将自动重试：{pollError}
            </div>
          ) : null}

          <div className="space-y-3">
            {items.map((item) => {
              const itemProgress = getWorkflowJobProgress(item);
              return (
                <div key={item.id} className="rounded-md border border-gray-200 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="line-clamp-1 text-sm font-medium text-gray-950">{item.title}</div>
                      <div className="mt-1 text-xs text-gray-500">{item.offerId} · {currentStepText(item)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!isWorkflowJobTerminal(item) ? <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" /> : null}
                      <StatusBadge status={item.status} />
                      <span className="w-10 text-right text-xs tabular-nums text-gray-500">{itemProgress}%</span>
                    </div>
                  </div>
                  <div className="mt-3"><ProgressBar value={itemProgress} /></div>
                  {item.error ? <div className="mt-3 text-sm text-red-700">{item.error}</div> : null}
                </div>
              );
            })}
          </div>

          {allDone ? (
            <div role="status" className={`mt-5 rounded-md border p-4 ${failedCount ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div className="flex items-start gap-2">
                <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${failedCount ? "text-amber-700" : "text-emerald-700"}`} />
                <div className="text-sm">
                  <div className="font-medium text-gray-950">本批次处理完成</div>
                  <div className="mt-1 text-gray-600">成功 {items.length - failedCount} 个，失败 {failedCount} 个。</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" onClick={onBack}>返回审核</Button>
                <Button onClick={onMonitor}>查看监控</Button>
              </div>
            </div>
          ) : null}
        </>
      ) : ready ? (
        <EmptyState title="暂无上架任务" description="先在审核步骤选择商品并开始上架。">
          <Button variant="outline" onClick={onBack}>返回审核</Button>
        </EmptyState>
      ) : null}
    </Card>
  );
}
