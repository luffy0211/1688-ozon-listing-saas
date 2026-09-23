import type { NextRequest } from "next/server";
import { AgentActionStatus, AgentActionType, prisma } from "@saas/db";
import { approveAgentAction, executeApprovedAgentAction } from "@/lib/agent/actions";
import { serializeAgentAction } from "@/lib/agent/runtime";
import { fail, forbidden, notFound, ok, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function editableSuggestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((suggestion) => {
    const item = asRecord(suggestion);
    const field = typeof item.field === "string" ? item.field.trim() : "";
    const suggestedRu = typeof item.suggestedRu === "string" ? item.suggestedRu.trim() : "";
    if (!field || !suggestedRu || suggestedRu.length > 3000) return [];
    return [{ field, suggestedRu }];
  });
}

async function applyContentDraftEdits(params: {
  tenantId: string;
  actionId: string;
  suggestions: Array<{ field: string; suggestedRu: string }>;
}) {
  if (!params.suggestions.length) return null;
  const action = await prisma.agentAction.findFirst({
    where: {
      id: params.actionId,
      tenantId: params.tenantId,
    },
  });
  if (!action) return null;
  if (
    action.type !== AgentActionType.CONTENT_DRAFT ||
    action.status !== AgentActionStatus.PENDING_APPROVAL
  ) {
    return action;
  }
  const payload = asRecord(action.payloadJson);
  const current = Array.isArray(payload.suggestions)
    ? payload.suggestions.map(asRecord)
    : [];
  const byField = new Map(params.suggestions.map((item) => [item.field, item.suggestedRu]));
  const next = current.map((item) => ({
    ...item,
    suggestedRu: byField.get(String(item.field)) ?? item.suggestedRu,
  }));
  return prisma.agentAction.update({
    where: { id: action.id },
    data: {
      payloadJson: {
        ...payload,
        suggestions: next,
        editedByUser: true,
      } as never,
    },
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const body = await req.json().catch(() => ({}));
  const suggestions = editableSuggestions(asRecord(body).suggestions);
  if (Array.isArray(asRecord(body).suggestions) && !suggestions.length) {
    return fail("invalid_content_draft_edits", "草稿修改内容为空或过长");
  }
  if (suggestions.length) {
    const updated = await applyContentDraftEdits({
      tenantId: session.tenantId,
      actionId: params.id,
      suggestions,
    });
    if (!updated) return notFound("Agent action not found");
    if (
      updated.type !== AgentActionType.CONTENT_DRAFT ||
      updated.status !== AgentActionStatus.PENDING_APPROVAL
    ) {
      return ok({ action: serializeAgentAction(updated) });
    }
  }

  const approved = await approveAgentAction({
    tenantId: session.tenantId,
    userId: session.userId,
    actionId: params.id,
  });
  if (!approved) return notFound("Agent action not found");

  const executed = await executeApprovedAgentAction({
    tenantId: session.tenantId,
    userId: session.userId,
    actionId: params.id,
  });
  if (!executed) return notFound("Agent action not found");

  return ok({ action: serializeAgentAction(executed) });
}
