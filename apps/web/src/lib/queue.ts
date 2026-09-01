import { Queue } from "bullmq";

let queue: Queue | null = null;

/** 上架流水线队列（worker 消费）。lazy 初始化，避免构建期连 Redis。 */
export function getListingQueue(): Queue {
  if (!queue) {
    queue = new Queue("listing", {
      connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return queue;
}
