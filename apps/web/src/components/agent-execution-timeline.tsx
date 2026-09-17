"use client";

import { CheckCircle2, Circle, Clock3, Loader2, XCircle } from "lucide-react";
import { Badge, cn } from "./ui";

export type AgentTimelineStep = {
  id: string;
  kind: string;
  title: string;
  description: string;
  expectedTool?: string | null;
  status: "pending" | "running" | "succeeded" | "failed" | "waiting" | "skipped";
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  toolName?: string | null;
  inputSummary?: string | null;
  outputSummary?: string | null;
  error?: string | null;
};

function statusLabel(status: AgentTimelineStep["status"]) {
  const labels: Record<AgentTimelineStep["status"], string> = {
    pending: "待执行",
    running: "执行中",
    succeeded: "成功",
    failed: "失败",
    waiting: "等待确认",
    skipped: "已跳过",
  };
  return labels[status];
}

function statusTone(status: AgentTimelineStep["status"]) {
  if (status === "succeeded") return "green";
  if (status === "failed") return "red";
  if (status === "waiting" || status === "running") return "amber";
  if (status === "skipped") return "gray";
  return "blue";
}

function StepIcon({ status }: { status: AgentTimelineStep["status"] }) {
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />;
  if (status === "waiting") return <Clock3 className="h-4 w-4 text-amber-600" aria-hidden="true" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />;
  return <Circle className="h-4 w-4 text-gray-400" aria-hidden="true" />;
}

function formatTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function AgentExecutionTimeline({ steps }: { steps?: AgentTimelineStep[] }) {
  if (!steps?.length) return null;

  const finishedCount = steps.filter((step) => ["succeeded", "waiting"].includes(step.status)).length;
  const failedCount = steps.filter((step) => step.status === "failed").length;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[#dbe6fb] bg-[#f8fbff]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dbe6fb] bg-white/75 px-3 py-2">
        <div>
          <div className="text-xs font-bold text-[#26334d]">Agent 执行过程</div>
          <div className="mt-0.5 text-[11px] text-[#8290a8]">
            {finishedCount}/{steps.length} 步完成{failedCount ? ` · ${failedCount} 步失败` : ""}
          </div>
        </div>
        <Badge tone={failedCount ? "red" : finishedCount === steps.length ? "green" : "blue"}>
          {failedCount ? "需要处理" : finishedCount === steps.length ? "已完成" : "进行中"}
        </Badge>
      </div>
      <div className="space-y-0 px-3 py-2">
        {steps.map((step, index) => (
          <div key={step.id} className="relative grid grid-cols-[20px_1fr] gap-2 pb-3 last:pb-0">
            {index < steps.length - 1 ? (
              <div className="absolute left-[7px] top-5 h-[calc(100%-18px)] w-px bg-[#dbe6fb]" />
            ) : null}
            <div className="relative z-10 mt-0.5 flex h-4 w-4 items-center justify-center bg-[#f8fbff]">
              <StepIcon status={step.status} />
            </div>
            <div className={cn("min-w-0 rounded-lg border bg-white px-3 py-2", step.status === "failed" ? "border-red-200" : "border-[#e2eaf4]")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#26334d]">{step.title}</div>
                  <div className="mt-0.5 text-[11px] leading-5 text-[#667085]">{step.description}</div>
                </div>
                <Badge tone={statusTone(step.status)}>{statusLabel(step.status)}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#667085]">
                {step.toolName ? <span className="rounded-md bg-[#eef4ff] px-2 py-0.5 font-mono">{step.toolName}</span> : null}
                {step.expectedTool && !step.toolName ? <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono">{step.expectedTool}</span> : null}
                {formatTime(step.startedAt) ? <span>{formatTime(step.startedAt)}</span> : null}
              </div>
              {step.inputSummary ? <div className="mt-1 text-[11px] text-[#8290a8]">输入：{step.inputSummary}</div> : null}
              {step.outputSummary ? <div className="mt-1 text-[11px] text-[#52627b]">结果：{step.outputSummary}</div> : null}
              {step.error ? <div className="mt-1 text-[11px] font-semibold text-red-700">错误：{step.error}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
