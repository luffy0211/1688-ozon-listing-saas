import type { NextRequest } from "next/server";
import { fail, forbidden, unauthorized } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest, _props: { params: Promise<{ id: string }> }) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!session.tenantId) return forbidden();

  return fail(
    "legacy_agent_retired",
    "旧版 Agent 接口已停用，请使用 /api/v1/agent/content/sessions/{id}/messages/start（请求和响应格式不同）。",
    [{ endpoint: "/api/v1/agent/content/sessions/{id}/messages/start" }],
    410,
  );
}
