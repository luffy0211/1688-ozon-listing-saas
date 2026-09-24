import type { NextRequest } from "next/server";
import {
  ContentAgentConfigurationError,
  ContentAgentInputError,
  runOzonContentAgent,
} from "@/lib/agent/content-agent";
import type { AgentRunProgressSnapshot } from "@/lib/agent/run-progress";
import { fail, forbidden, ok, unauthorized } from "@/lib/api";
import { CreditAdjustmentError } from "@/lib/credits";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const requestSession = await sessionFromRequest(req);
  if (!requestSession) return unauthorized();
  if (!requestSession.tenantId) return forbidden();

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return fail("invalid_prompt", "请输入要让内容 Agent 处理的消息。");

  let started = false;
  let rejectStart: (error: unknown) => void = () => null;
  const startedPromise = new Promise<AgentRunProgressSnapshot>((resolve, reject) => {
    rejectStart = reject;
    void runOzonContentAgent({
      tenantId: requestSession.tenantId!,
      userId: requestSession.userId,
      prompt,
      sessionId: params.id === "new" ? null : params.id,
      storeId: typeof body.storeId === "string" ? body.storeId : null,
      onStarted: (snapshot) => {
        started = true;
        resolve(snapshot);
      },
    }).catch((error) => {
      if (!started) rejectStart(error);
    });
  });

  try {
    const snapshot = await startedPromise;
    return ok({
      sessionId: snapshot.sessionId,
      runId: snapshot.runId,
      status: snapshot.status,
      plan: snapshot.plan,
      executionTrace: snapshot.executionTrace,
    });
  } catch (error) {
    if (error instanceof ContentAgentConfigurationError) {
      return fail(error.code, error.message, [], error.status);
    }
    if (error instanceof ContentAgentInputError) {
      return fail(error.code, error.message, [], error.status);
    }
    if (error instanceof CreditAdjustmentError) {
      return fail(error.code, error.message, [], error.status);
    }
    return fail("content_agent_start_failed", error instanceof Error ? error.message : String(error), [], 500);
  }
}
