import { AgentRunStatus, prisma } from "@saas/db";
// ponytail: reuse one executor; extract a package if this cross-app import stops compiling cleanly.
import {
  executeApprovedAgentAction,
  recoverBlockedAgentAction,
} from "../../web/src/lib/agent/actions";

export type AgentQueueJob = {
  actionId?: string;
  tenantId?: string;
  userId?: string;
};

type QueueWriter = {
  add(
    name: string,
    data: AgentQueueJob,
    options: { jobId: string },
  ): Promise<unknown>;
};

export async function sweepAgentRecovery(queue: QueueWriter, now = new Date()) {
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
          startedAt: { lt: runCutoff },
        },
        select: { id: true, tenantId: true, startedAt: true, toolCallsJson: true },
      }),
    ]);
    return { actions, runs };
  }));
  const staleActions = candidates.flatMap((candidate) => candidate.actions);
  const runCandidates = candidates.flatMap((candidate) => candidate.runs);
  const staleRuns = runCandidates.filter((run) => {
    const progress = run.toolCallsJson && typeof run.toolCallsJson === "object"
      ? run.toolCallsJson as Record<string, unknown>
      : {};
    const progressAt = typeof progress.progressUpdatedAt === "string"
      ? Date.parse(progress.progressUpdatedAt)
      : run.startedAt.getTime();
    return !Number.isFinite(progressAt) || progressAt < progressCutoff;
  });
  await Promise.all(staleRuns.map((run) => prisma.agentRun.updateMany({
    where: { id: run.id, tenantId: run.tenantId, status: AgentRunStatus.RUNNING },
    data: {
      status: AgentRunStatus.FAILED,
      error: "content_agent_interrupted",
      finishedAt: now,
    },
  })));

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
) {
  if (name === "scan-agent-recovery") return sweepAgentRecovery(queue);
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
