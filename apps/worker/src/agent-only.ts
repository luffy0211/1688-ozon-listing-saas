import { Queue, Worker } from "bullmq";
import { getAgentQueueName } from "../../web/src/lib/agent/action-queue";
import { processAgentQueueJob, type AgentQueueJob } from "./agent-recovery";

const name = getAgentQueueName();
if (name === "ozon-agent") throw new Error("agent-only requires an isolated AGENT_QUEUE_NAME");
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
const queue = new Queue<AgentQueueJob>(name, { connection });
const worker = new Worker<AgentQueueJob>(name, async (job) => {
  if (job.name !== "run-content-agent") throw new Error("agent-only accepts diagnosis jobs only");
  return processAgentQueueJob(job.name, job.data, queue, { stalledCounter: job.stalledCounter });
}, { connection, concurrency: 2 });

worker.on("failed", (job, error) => console.error(`agent job failed: ${job?.id}`, error));
worker.on("error", (error) => console.error("agent worker error", error));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void worker.close().then(() => queue.close()).catch((error) => {
    console.error("agent worker shutdown failed", error);
    process.exitCode = 1;
  }); });
}
console.log(`diagnosis worker started: ${name}`);
