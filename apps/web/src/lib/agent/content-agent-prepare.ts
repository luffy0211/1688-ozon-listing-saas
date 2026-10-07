import { prisma } from "@saas/db";
import { consumeTenantCredits } from "../credits";
import { env } from "../env";
import { extractOfferId } from "./chat-input";
import { redactSensitiveText } from "./policy";
import { getAgentQueueName } from "./action-queue";

export type PreparedContentAgentRun = {
  sessionId: string;
  userMessageId: string;
  runId: string;
};
export type ContentAgentJob = PreparedContentAgentRun & { tenantId: string; userId: string };
type ContentAgentInput = {
  tenantId: string;
  userId: string;
  prompt: string;
  sessionId?: string | null;
  storeId?: string | null;
};

export class ContentAgentPreparationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly details: unknown[] = []) {
    super(message);
  }
}

function requireConfiguredModel() {
  if (!env.openaiApiKey?.trim() || !env.openaiAgentModel?.trim() || env.openaiAgentMock) {
    throw new ContentAgentPreparationError("content_agent_model_not_configured", "内容 Agent 尚未配置可用模型，请联系管理员配置后再试。");
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function contentAgentDispatch(value: unknown) {
  return record(record(value).dispatch);
}

export async function prepareOzonContentAgentRun(input: ContentAgentInput): Promise<ContentAgentJob> {
  if (input.prompt.length > 20_000) throw new ContentAgentPreparationError("invalid_prompt", "消息不能超过 20000 个字符。");
  const prompt = redactSensitiveText(input.prompt.trim());
  if (!prompt) throw new ContentAgentPreparationError("invalid_prompt", "请输入要让内容 Agent 处理的消息。");
  requireConfiguredModel();
  const storeId = input.storeId?.trim();
  const requestedStoreId = storeId && !["null", "undefined"].includes(storeId.toLowerCase()) ? storeId : null;
  return prisma.$transaction(async (tx) => {
    const existing = input.sessionId ? await tx.agentSession.findFirst({
      where: { id: input.sessionId, tenantId: input.tenantId, status: "OPEN" },
    }) : null;
    if (input.sessionId && !existing) {
      throw new ContentAgentPreparationError("content_agent_session_not_found", "会话不存在或已归档，请重新打开有效会话。", 404);
    }
    if (existing) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.tenantId}), hashtext(${existing.id}))`;
      const active = await tx.agentRun.findFirst({
        where: { tenantId: input.tenantId, sessionId: existing.id, status: "RUNNING" },
        select: { id: true },
      });
      if (active) throw new ContentAgentPreparationError("content_agent_run_in_progress", "此会话已有任务正在处理，请等待现有任务完成。", 409, [
        { sessionId: existing.id, runId: active.id },
      ]);
    }
    const store = await tx.store.findFirst({
      where: { tenantId: input.tenantId, ...(requestedStoreId ? { id: requestedStoreId } : {}) },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (requestedStoreId && !store) {
      throw new ContentAgentPreparationError("ozon_store_not_found", "没有找到可用的 Ozon 店铺配置。");
    }
    const title = prompt.replace(/\s+/g, " ");
    const session = existing ?? await tx.agentSession.create({
      data: { tenantId: input.tenantId, createdBy: input.userId, title: title.length > 36 ? `${title.slice(0, 36)}...` : title },
    });
    const run = await tx.agentRun.create({
      data: {
        tenantId: input.tenantId, sessionId: session.id, requestedBy: input.userId,
        status: "RUNNING", input: prompt,
        model: env.openaiAgentModel,
        toolCallsJson: { agent: "ozon_content_v1", plan: [], executionTrace: [], dispatch: { state: "pending" } },
      },
    });
    // The user message owns dispatch state: progress snapshots replace run.toolCallsJson.
    const message = await tx.agentMessage.create({
      data: {
        tenantId: input.tenantId, sessionId: session.id, role: "USER", content: prompt,
        metaJson: { agent: "ozon_content_v1", runId: run.id, storeId: store?.id ?? null, offerId: extractOfferId(prompt), dispatch: { state: "pending", queueName: getAgentQueueName() } },
      },
    });
    return { tenantId: input.tenantId, userId: input.userId, sessionId: session.id, userMessageId: message.id, runId: run.id };
  });
}

export async function beginContentAgentRun(input: ContentAgentInput & { preparedRun?: PreparedContentAgentRun }) {
  const job = input.preparedRun ?? await prepareOzonContentAgentRun(input);
  const prepared = await prisma.$transaction(async (tx) => {
    const runRecord = await tx.agentRun.findFirst({
      where: { id: job.runId, tenantId: input.tenantId, sessionId: job.sessionId, requestedBy: input.userId },
    });
    if (!runRecord) throw new ContentAgentPreparationError("content_agent_run_not_found", "任务不存在。", 404);
    const userMessage = await tx.agentMessage.findFirst({
      where: {
        id: job.userMessageId, tenantId: input.tenantId, sessionId: job.sessionId, role: "USER",
        metaJson: { path: ["runId"], equals: job.runId },
      },
    });
    const metadata = record(userMessage?.metaJson);
    if (!userMessage || metadata.agent !== "ozon_content_v1") {
      throw new ContentAgentPreparationError("content_agent_run_not_found", "任务消息不存在。", 404);
    }
    if ((contentAgentDispatch(metadata).queueName ?? "ozon-agent") !== getAgentQueueName()) {
      throw new ContentAgentPreparationError("content_agent_queue_mismatch", "任务不属于当前后台队列。", 409);
    }
    if (runRecord.status !== "RUNNING" || contentAgentDispatch(metadata).state !== "pending") {
      throw new ContentAgentPreparationError("content_agent_already_dispatched", "任务已开始或已结束，不会重复执行。", 409);
    }
    requireConfiguredModel();
    const session = await tx.agentSession.findFirst({
      where: { id: job.sessionId, tenantId: input.tenantId, status: "OPEN" },
    });
    if (!session) throw new ContentAgentPreparationError("content_agent_session_not_found", "会话不存在或已归档。", 404);
    const storeId = typeof metadata.storeId === "string" ? metadata.storeId : null;
    if (storeId && !await tx.store.findFirst({ where: { id: storeId, tenantId: input.tenantId }, select: { id: true } })) {
      throw new ContentAgentPreparationError("ozon_store_not_found", "任务关联的店铺已不可用，请检查店铺配置。");
    }
    const now = new Date();
    const claimed = await tx.agentMessage.updateMany({
      where: {
        id: job.userMessageId, tenantId: input.tenantId, sessionId: job.sessionId,
        metaJson: { equals: userMessage.metaJson! },
      },
      data: { metaJson: { ...metadata, dispatch: { state: "executing", queueName: getAgentQueueName(), startedAt: now.toISOString() } } as never },
    });
    if (!claimed.count) throw new ContentAgentPreparationError("content_agent_already_dispatched", "任务已由其他 worker 领取。", 409);
    const running = await tx.agentRun.updateMany({
      where: { id: job.runId, tenantId: input.tenantId, sessionId: job.sessionId, status: "RUNNING" },
      data: { startedAt: now },
    });
    if (!running.count) throw new ContentAgentPreparationError("content_agent_already_dispatched", "任务已结束。", 409);
    return { session, userMessage, runRecord, prompt: runRecord.input, storeId };
  });
  try {
    await consumeTenantCredits({
      tenantId: input.tenantId, createdBy: input.userId, feature: "agent_message",
      referenceType: "agent_message", referenceId: job.userMessageId, idempotencyKey: `agent-message:${job.userMessageId}`,
    });
  } catch (error) {
    await prisma.agentRun.updateMany({
      where: { id: job.runId, tenantId: input.tenantId, sessionId: job.sessionId, status: "RUNNING" },
      data: { status: "FAILED", error: "content_agent_credit_failed", output: "任务未开始执行，请检查积分余额后重新发起。", finishedAt: new Date() },
    });
    throw error;
  }
  return prepared;
}
