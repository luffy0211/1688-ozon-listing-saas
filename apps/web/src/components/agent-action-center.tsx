"use client";

import { useState } from "react";
import { CheckCircle2, Play, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, Table } from "@/components/ui";

export type AgentActionCenterItem = {
  id: string;
  type: string;
  status: string;
  riskLevel: string;
  title: string;
  rationale: string;
  storeId: string | null;
  offerId: string | null;
  productId: string | null;
  error: string | null;
  executionPhase?: "executing" | "verification_pending" | "manual_required" | "finished" | null;
  createdAt: string;
  updatedAt: string;
};

function toneForStatus(status: string): "gray" | "green" | "red" | "amber" | "blue" | "violet" {
  if (["EXECUTED", "RECOMMENDED"].includes(status)) return "green";
  if (["FAILED", "BLOCKED", "REJECTED"].includes(status)) return "red";
  if (["PENDING_APPROVAL", "APPROVED"].includes(status)) return "amber";
  return "gray";
}

function commandLabel(command: "confirm-execute" | "reject" | "execute") {
  if (command === "confirm-execute") return "确认并执行";
  if (command === "execute") return "执行";
  return "拒绝";
}

function visibleStatus(action: AgentActionCenterItem) {
  if (action.executionPhase === "executing") return "执行中";
  if (action.executionPhase === "verification_pending") return "等待平台核验";
  if (action.executionPhase === "manual_required") return "需要人工处理";
  return action.status;
}

export function AgentActionCenter({ initialActions }: { initialActions: AgentActionCenterItem[] }) {
  const [actions, setActions] = useState(initialActions);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function runCommand(actionId: string, command: "confirm-execute" | "reject" | "execute") {
    setBusyId(actionId);
    setMessage(null);
    try {
      const action = actions.find((item) => item.id === actionId);
      const response = await fetch(`/api/v1/agent/actions/${actionId}/${command}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action ? {
          expectedVersion: action.updatedAt,
          expectedStoreId: action.storeId,
        } : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? `${commandLabel(command)}失败`);
      }
      const updated = payload?.data?.action;
      if (updated?.id) {
        setActions((current) => current.map((item) => item.id === actionId
          ? {
              ...item,
              status: updated.status ?? item.status,
              error: updated.error ?? null,
              executionPhase: updated.executionPhase ?? item.executionPhase,
              updatedAt: updated.updatedAt ?? item.updatedAt,
            }
          : item));
      }
      setMessage(`${commandLabel(command)}已提交`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  if (actions.length === 0) {
    return <EmptyState title="暂无待审批动作" description="Agent 生成修改建议、活动报名或上架动作后，会集中显示在这里。" />;
  }

  return (
    <Card>
      {message ? (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
          {message}
        </div>
      ) : null}
      <Table head={["动作", "状态", "风险", "对象", "原因", "操作"]}>
        {actions.map((action) => {
          const canConfirm = action.status === "PENDING_APPROVAL";
          const canExecute = action.status === "APPROVED";
          const canReject = ["PENDING_APPROVAL", "RECOMMENDED"].includes(action.status);
          return (
            <tr key={action.id} className="hover:bg-gray-50">
              <td className="min-w-[280px] px-4 py-3">
                <div className="font-semibold text-gray-950">{action.title}</div>
                <div className="mt-1 text-xs text-gray-500">{action.type} · {new Date(action.createdAt).toLocaleString("zh-CN")}</div>
                {action.error ? <div className="mt-1 text-xs text-red-700">{action.error}</div> : null}
              </td>
              <td className="px-4 py-3"><Badge tone={toneForStatus(action.status)}>{visibleStatus(action)}</Badge></td>
              <td className="px-4 py-3">{action.riskLevel}</td>
              <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-gray-500">
                {action.offerId ?? action.productId ?? "-"}
              </td>
              <td className="max-w-md truncate px-4 py-3 text-gray-600">{action.rationale}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {canConfirm ? (
                    <Button
                      onClick={() => runCommand(action.id, "confirm-execute")}
                      disabled={busyId === action.id}
                      variant="success"
                      className="h-8"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      确认执行
                    </Button>
                  ) : null}
                  {canExecute ? (
                    <Button
                      onClick={() => runCommand(action.id, "execute")}
                      disabled={busyId === action.id}
                      className="h-8"
                    >
                      <Play className="h-4 w-4" />
                      执行
                    </Button>
                  ) : null}
                  {canReject ? (
                    <Button
                      onClick={() => runCommand(action.id, "reject")}
                      disabled={busyId === action.id}
                      variant="outline"
                      className="h-8"
                    >
                      <XCircle className="h-4 w-4" />
                      拒绝
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}
