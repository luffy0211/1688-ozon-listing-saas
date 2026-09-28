import type { NextRequest } from "next/server";
import {
  ContentAgentPreparationError,
  prepareOzonContentAgentRun,
} from "@/lib/agent/content-agent-prepare";
import { enqueueContentAgentRun } from "@/lib/agent/action-queue";
import { fail, forbidden, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const requestSession = await sessionFromRequest(req);
  if (!requestSession) return unauthorized();
  if (!requestSession.tenantId) return forbidden();

  const body = (await req.json().catch(() => null)) ?? {};
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return fail("invalid_prompt", "请输入要让内容 Agent 处理的消息。");
  if (body.prompt.length > 20_000) return fail("invalid_prompt", "消息不能超过 20000 个字符。");

  try {
    const job = await prepareOzonContentAgentRun({
      tenantId: requestSession.tenantId,
      userId: requestSession.userId,
      prompt,
      sessionId: params.id === "new" ? null : params.id,
      storeId: typeof body.storeId === "string" ? body.storeId : null,
    });
    try {
      await enqueueContentAgentRun(job);
    } catch {
      return fail("content_agent_queue_unavailable", "任务已保存，但暂时无法确认派发。请稍后查看此会话；若持续未开始，请联系管理员恢复队列，不要重复提交。", [
        { sessionId: job.sessionId, runId: job.runId },
      ], 503);
    }
    // Both content message POST endpoints return this asynchronous queued-run contract.
    return ok({
      sessionId: job.sessionId,
      runId: job.runId,
      status: "running",
      plan: [],
      executionTrace: [],
    }, 202);
  } catch (error) {
    if (error instanceof ContentAgentPreparationError) {
      return fail(error.code, error.message, error.details, error.status);
    }
    return fail("content_agent_start_failed", "任务暂时无法创建，请稍后重试。", [], 500);
  }
}
