import { Queue } from "bullmq";
import { env } from "../env";
import type { ContentAgentJob } from "./content-agent-prepare";

export type AgentActionJob = {
  actionId: string;
  tenantId: string;
  userId: string;
};

let queue: Queue<AgentActionJob | ContentAgentJob> | null = null;

export function getAgentQueueName() {
  return process.env.AGENT_QUEUE_NAME?.trim() || "ozon-agent";
}

export function getAgentActionQueue() {
  if (!queue) {
    queue = new Queue<AgentActionJob | ContentAgentJob>(getAgentQueueName(), {
      connection: { url: env.redisUrl, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 5000 },
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return queue;
}

export type ContentAgentQueueWriter = {
  add(name: string, data: ContentAgentJob, options: { jobId: string; attempts: number }): Promise<unknown>;
  getJob?(id: string): Promise<{ isFailed(): Promise<boolean>; retry(): Promise<unknown> } | null | undefined>;
};

export async function enqueueContentAgentRun(job: ContentAgentJob, agentQueue: ContentAgentQueueWriter = getAgentActionQueue()) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const jobId = `agent-content-${job.runId}`;
        const existing = await agentQueue.getJob?.(jobId);
        if (existing) {
          if (await existing.isFailed()) await existing.retry();
          return;
        }
        await agentQueue.add("run-content-agent", job, { jobId, attempts: 1 });
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("content_agent_queue_timeout")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function enqueueAgentActionExecution(job: AgentActionJob) {
  const agentQueue = getAgentActionQueue();
  const jobId = `agent-action-${job.actionId}`;
  const existing = await agentQueue.getJob(jobId);
  if (existing) {
    if (await existing.isFailed()) await existing.retry();
    return;
  }
  await agentQueue.add("execute-agent-action", job, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
  });
}
