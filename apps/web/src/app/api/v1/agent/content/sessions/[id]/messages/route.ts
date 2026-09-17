import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import {
  ContentAgentConfigurationError,
  ContentAgentInputError,
  contentAgentDataSourcesFromToolCalls,
  runOzonContentAgent,
  serializeContentAgentAction,
  serializeContentAgentResult,
} from "@/lib/agent/content-agent";
import { fail, forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { CreditAdjustmentError } from "@/lib/credits";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringFromRecord(value: unknown, key: string) {
  const item = asRecord(value)[key];
  return typeof item === "string" && item ? item : null;
}

function dataSourcesFromRun(run: { toolCallsJson: unknown } | null | undefined) {
  const toolCallsJson = asRecord(run?.toolCallsJson);
  const dataSources = toolCallsJson.dataSources;
  if (Array.isArray(dataSources)) return dataSources;

  const toolCalls = toolCallsJson.toolCalls;
  return Array.isArray(toolCalls)
    ? contentAgentDataSourcesFromToolCalls(toolCalls as never)
    : [];
}

function arrayFromRun(run: { toolCallsJson: unknown } | null | undefined, key: string) {
  const value = asRecord(run?.toolCallsJson)[key];
  return Array.isArray(value) ? value : [];
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const requestSession = await sessionFromRequest(req);
  if (!requestSession) return unauthorized();
  if (!requestSession.tenantId) return forbidden();

  const agentSession = await prisma.agentSession.findFirst({
    where: {
      id: params.id,
      tenantId: requestSession.tenantId,
      OR: [
        {
          messages: {
            some: {
              metaJson: { path: ["agent"], equals: "ozon_content_v1" },
            },
          },
        },
        {
          runs: {
            some: {
              toolCallsJson: { path: ["agent"], equals: "ozon_content_v1" },
            },
          },
        },
      ],
    },
    select: { id: true, title: true, status: true, updatedAt: true },
  });
  if (!agentSession) return notFound("Content agent session not found");

  const messages = await prisma.agentMessage.findMany({
    where: { tenantId: requestSession.tenantId, sessionId: params.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      metaJson: true,
      createdAt: true,
    },
  });

  const runIds = [
    ...new Set(
      messages
        .map((message) => stringFromRecord(message.metaJson, "runId"))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [runs, actions] = await Promise.all([
    runIds.length
      ? prisma.agentRun.findMany({
          where: {
            tenantId: requestSession.tenantId,
            sessionId: params.id,
            id: { in: runIds },
          },
          select: { id: true, toolCallsJson: true },
        })
      : Promise.resolve([]),
    runIds.length
      ? prisma.agentAction.findMany({
          where: {
            tenantId: requestSession.tenantId,
            sessionId: params.id,
            runId: { in: runIds },
          },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const runsById = new Map(runs.map((run) => [run.id, run]));
  const actionsByRunId = new Map<string, typeof actions>();
  for (const action of actions) {
    if (!action.runId) continue;
    actionsByRunId.set(action.runId, [
      ...(actionsByRunId.get(action.runId) ?? []),
      action,
    ]);
  }

  return ok({
    session: {
      id: agentSession.id,
      title: agentSession.title,
      status: agentSession.status,
      updatedAt: agentSession.updatedAt.toISOString(),
    },
    messages: messages.map((message) => {
      const runId = stringFromRecord(message.metaJson, "runId");
      const run = runId ? runsById.get(runId) : null;
      return {
        id: message.id,
        role: message.role === "USER" ? "user" : "assistant",
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        dataSources: message.role === "ASSISTANT" ? dataSourcesFromRun(run) : [],
        plan: message.role === "ASSISTANT" ? arrayFromRun(run, "plan") : [],
        executionTrace: message.role === "ASSISTANT" ? arrayFromRun(run, "executionTrace") : [],
        actions: runId
          ? (actionsByRunId.get(runId) ?? []).map((action) =>
              serializeContentAgentAction(action),
            )
          : [],
      };
    }),
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const requestSession = await sessionFromRequest(req);
  if (!requestSession) return unauthorized();
  if (!requestSession.tenantId) return forbidden();

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return fail("invalid_prompt", "请输入要让内容 Agent 处理的消息。");
  }

  try {
    const result = await runOzonContentAgent({
      tenantId: requestSession.tenantId,
      userId: requestSession.userId,
      prompt,
      sessionId: params.id === "new" ? null : params.id,
      storeId: typeof body.storeId === "string" ? body.storeId : null,
    });
    return ok(serializeContentAgentResult(result));
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
    return fail(
      "content_agent_run_failed",
      error instanceof Error ? error.message : String(error),
      [],
      500,
    );
  }
}
