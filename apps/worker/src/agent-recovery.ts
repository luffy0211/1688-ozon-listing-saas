import { AgentRunStatus, prisma } from "@saas/db";
import { enqueueContentAgentRun, getAgentQueueName, type ContentAgentQueueWriter } from "../../web/src/lib/agent/action-queue";
import { contentAgentDispatch, ContentAgentPreparationError } from "../../web/src/lib/agent/content-agent-prepare";
import { runOzonContentAgent } from "../../web/src/lib/agent/content-agent";
// ponytail: reuse one executor; extract a package if this cross-app import stops compiling cleanly.
import {
  executeApprovedAgentAction,
  recoverBlockedAgentAction,
} from "../../web/src/lib/agent/actions";

export type AgentQueueJob = {
  actionId?: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  userMessageId?: string;
  runId?: string;
};

type QueueWriter = {
  name?: string;
  getJob?: ContentAgentQueueWriter["getJob"];
  add(
    name: string,
    data: AgentQueueJob,
    options: { jobId: string; attempts?: number },
  ): Promise<unknown>;
};

const interruptedOutput = "任务执行中断，无法确认最后一步是否完成，因此不会自动重放付费工具或重复生成草案。请先查看本会话已有结果、待确认草案和积分记录，确认后再发起新任务。";

export async function sweepAgentRecovery(queue: QueueWriter, now = new Date()) {
  if ((queue.name ?? getAgentQueueName()) !== "ozon-agent") return;
  const actionCutoff = new Date(now.getTime() - 120_000);
  const runCutoff = new Date(now.getTime() - 30 * 60_000);
  const progressCutoff = now.getTime() - 20 * 60_000;
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const candidates = await Promise.all(tenants.map(async ({ id: tenantId }) => {
    const [actions, runs] = await Promise.all([
      prisma.agentAction.findMany({
        where: {
          tenantId,
          status: "BLOCKED",
          error: { in: ["execution_in_progress", "result_pending_verification"] },
          updatedAt: { lt: actionCutoff },
        },
        select: {
          id: true,
          tenantId: true,
          approvedBy: true,
          requestedBy: true,
          updatedAt: true,
        },
      }),
      prisma.agentRun.findMany({
        where: {
          tenantId,
          status: AgentRunStatus.RUNNING,
          startedAt: { lt: actionCutoff },
          toolCallsJson: { path: ["agent"], equals: "ozon_content_v1" },
        },
        select: { id: true, tenantId: true, sessionId: true, requestedBy: true, startedAt: true, toolCallsJson: true },
      }),
    ]);
    return { actions, runs };
  }));
  const staleActions = candidates.flatMap((candidate) => candidate.actions);
  const runCandidates = candidates.flatMap((candidate) => candidate.runs);
  for (const run of runCandidates) {
    const message = await prisma.agentMessage.findFirst({
      where: { tenantId: run.tenantId, sessionId: run.sessionId, role: "USER", metaJson: { path: ["runId"], equals: run.id } },
      select: { id: true, metaJson: true },
    });
    const dispatch = contentAgentDispatch(message?.metaJson);
    if ((dispatch.queueName ?? "ozon-agent") !== (queue.name ?? getAgentQueueName())) continue;
    if (dispatch.state === "pending" && message && run.requestedBy) {
      await enqueueContentAgentRun({
        tenantId: run.tenantId, userId: run.requestedBy, sessionId: run.sessionId, runId: run.id, userMessageId: message.id,
      }, queue);
      continue;
    }
    const progress = run.toolCallsJson && typeof run.toolCallsJson === "object"
      ? run.toolCallsJson as Record<string, unknown>
      : {};
    const progressAt = typeof progress.progressUpdatedAt === "string"
      ? Date.parse(progress.progressUpdatedAt)
      : run.startedAt.getTime();
    if (run.startedAt >= runCutoff || (Number.isFinite(progressAt) && progressAt >= progressCutoff)) continue;
    await prisma.agentRun.updateMany({
      where: {
        id: run.id, tenantId: run.tenantId, sessionId: run.sessionId, status: AgentRunStatus.RUNNING,
        startedAt: run.startedAt,
        toolCallsJson: { equals: run.toolCallsJson! },
      },
      data: {
        status: AgentRunStatus.FAILED,
        error: "content_agent_interrupted",
        output: interruptedOutput,
        finishedAt: now,
      },
    });
  }

  await Promise.all(staleActions.map((action) => queue.add(
    "reconcile-agent-action",
    {
      actionId: action.id,
      tenantId: action.tenantId,
      userId: action.approvedBy ?? action.requestedBy ?? undefined,
    },
    { jobId: `agent-reconcile-${action.id}-${action.updatedAt.getTime()}` },
  )));
}

export async function processAgentQueueJob(
  name: string,
  data: AgentQueueJob,
  queue: QueueWriter,
  attempt: { stalledCounter?: number } = {},
) {
  if (name === "scan-agent-recovery") return sweepAgentRecovery(queue);
  if (name === "run-content-agent") {
    if (![data.tenantId, data.userId, data.sessionId, data.userMessageId, data.runId].every((id) => typeof id === "string" && id.trim())) {
      throw new Error("invalid_content_agent_job");
    }
    try {
      return await runOzonContentAgent({
        tenantId: data.tenantId!, userId: data.userId!, prompt: "", sessionId: data.sessionId!,
        preparedRun: { sessionId: data.sessionId!, userMessageId: data.userMessageId!, runId: data.runId! },
      });
    } catch (error) {
      if (error instanceof ContentAgentPreparationError && error.code === "content_agent_already_dispatched") {
        if (attempt.stalledCounter) await prisma.agentRun.updateMany({
          where: { id: data.runId!, tenantId: data.tenantId!, sessionId: data.sessionId!, requestedBy: data.userId!, status: "RUNNING" },
          data: { status: "FAILED", error: "content_agent_interrupted", output: interruptedOutput, finishedAt: new Date() },
        });
        return;
      }
      // Scope/setup errors may occur before the executor's normal failure handler.
      if (!(error instanceof ContentAgentPreparationError && ["content_agent_run_not_found", "content_agent_queue_mismatch"].includes(error.code))) {
        await prisma.agentRun.updateMany({
          where: { id: data.runId!, tenantId: data.tenantId!, sessionId: data.sessionId!, requestedBy: data.userId!, status: "RUNNING" },
          data: {
            status: "FAILED", error: "content_agent_worker_failed",
            output: "任务未能完成，请检查会话、店铺配置与积分记录。已有草案不会自动重做；请确认后重新发起任务。", finishedAt: new Date(),
          },
        });
      }
      throw error;
    }
  }
  if (!data.actionId || !data.tenantId) throw new Error("invalid_agent_action_job");
  if (name === "execute-agent-action") {
    if (!data.userId) throw new Error("missing_agent_action_user");
    return executeApprovedAgentAction({
      actionId: data.actionId,
      tenantId: data.tenantId,
      userId: data.userId,
    });
  }
  if (name === "reconcile-agent-action") {
    return recoverBlockedAgentAction({
      actionId: data.actionId,
      tenantId: data.tenantId,
      userId: data.userId,
    });
  }
  throw new Error(`unsupported_agent_job:${name}`);
}
