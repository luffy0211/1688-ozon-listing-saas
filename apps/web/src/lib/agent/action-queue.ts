import { Queue } from "bullmq";
import { env } from "../env";

export type AgentActionJob = {
  actionId: string;
  tenantId: string;
  userId: string;
};

let queue: Queue<AgentActionJob> | null = null;

export function getAgentActionQueue() {
  if (!queue) {
    queue = new Queue<AgentActionJob>("ozon-agent", {
      connection: { url: env.redisUrl },
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return queue;
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
