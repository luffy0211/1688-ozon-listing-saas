import type { NextRequest } from "next/server";
import { fail, forbidden, ok, unauthorized } from "@/lib/api";
import { runOzonOpsAgent, serializeAgentResult } from "@/lib/agent/runtime";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return fail("invalid_prompt", "请输入要让 Agent 处理的问题。");
  const competitorUrls = Array.isArray(body.competitorUrls)
    ? body.competitorUrls.filter((url: unknown): url is string => typeof url === "string" && url.trim().length > 0)
    : [];

  try {
    const result = await runOzonOpsAgent({
      tenantId: session.tenantId,
      userId: session.userId,
      prompt,
      sessionId: params.id === "new" ? null : params.id,
      storeId: typeof body.storeId === "string" ? body.storeId : null,
      sourceProductId: typeof body.sourceProductId === "string" ? body.sourceProductId : null,
      competitorUrls,
      refreshOzonData: body.refreshOzonData === true,
    });
    return ok(serializeAgentResult(result));
  } catch (error) {
    return fail(
      "agent_run_failed",
      error instanceof Error ? error.message : String(error),
      [],
      500,
    );
  }
}
