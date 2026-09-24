import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import {
  contentAgentDataSourcesFromToolCalls,
  serializeContentAgentAction,
} from "@/lib/agent/content-agent";
import { getAgentRunProgress } from "@/lib/agent/run-progress";
import { forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const requestSession = await sessionFromRequest(req);
  if (!requestSession) return unauthorized();
  if (!requestSession.tenantId) return forbidden();

  const live = getAgentRunProgress(params.id);
  if (live) {
    if (live.tenantId !== requestSession.tenantId) return notFound("Agent run not found");
    return ok(live);
  }

  const run = await prisma.agentRun.findFirst({
    where: { id: params.id, tenantId: requestSession.tenantId },
    include: { actions: { orderBy: { createdAt: "asc" } } },
  });
  if (!run) return notFound("Agent run not found");

  const toolCallsJson = asRecord(run.toolCallsJson);
  const toolCalls = arrayFromRecord(toolCallsJson, "toolCalls");
  const dataSources = arrayFromRecord(toolCallsJson, "dataSources");

  return ok({
    tenantId: run.tenantId,
    sessionId: run.sessionId,
    runId: run.id,
    status: run.status === "FAILED" ? "failed" : run.status === "SUCCEEDED" ? "succeeded" : "running",
    output: run.output,
    error: run.error,
    plan: arrayFromRecord(toolCallsJson, "plan"),
    executionTrace: arrayFromRecord(toolCallsJson, "executionTrace"),
    actions: run.actions.map((action) => serializeContentAgentAction(action)),
    dataSources: dataSources.length ? dataSources : contentAgentDataSourcesFromToolCalls(toolCalls as never),
    updatedAt: typeof toolCallsJson.progressUpdatedAt === "string"
      ? toolCallsJson.progressUpdatedAt
      : (run.finishedAt ?? run.createdAt).toISOString(),
  });
}
