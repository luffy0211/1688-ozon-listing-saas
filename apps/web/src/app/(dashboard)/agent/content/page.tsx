import { Bot } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@saas/db";
import { serializeContentAgentAction } from "@/lib/agent/content-agent";
import { ContentAgentChat } from "@/components/content-agent-chat";
import { EmptyState } from "@/components/ui";
import { env } from "@/lib/env";

function contentAgentConfig() {
  const missing = [
    !env.openaiApiKey ? "OPENAI_API_KEY" : "",
    !env.openaiAgentModel ? "OPENAI_AGENT_MODEL" : "",
    env.openaiAgentMock ? "OPENAI_AGENT_MOCK=false" : "",
  ].filter(Boolean);

  return {
    configured: missing.length === 0,
    missing,
    message:
      missing.length === 0
        ? "模型已配置，可以运行内容 Agent。"
        : "要运行真正的 Agent，需要设置 OPENAI_API_KEY、OPENAI_AGENT_MODEL，并把 OPENAI_AGENT_MOCK 设为 false。使用 DeepSeek 时设置 OPENAI_BASE_URL=https://api.deepseek.com。当前不会使用 mock 回答。",
  };
}

export default async function ContentAgentPage() {
  const user = await requireUser();
  if (!user.tenantId) {
    return (
      <EmptyState
        title="还不能使用 Agent"
        description="管理员账号需要先进入平台管理并绑定租户。"
      />
    );
  }

  const [stores, sessions, actions] = await Promise.all([
    prisma.store.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true, name: true, isDefault: true },
    }),
    prisma.agentSession.findMany({
      where: {
        tenantId: user.tenantId,
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
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, title: true, status: true, updatedAt: true },
    }),
    prisma.agentAction.findMany({
      where: { tenantId: user.tenantId, type: "CONTENT_DRAFT" },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return stores.length ? (
    <ContentAgentChat
      stores={stores}
      sessions={sessions.map((session) => ({
        ...session,
        updatedAt: session.updatedAt.toISOString(),
      }))}
      initialActions={actions.map((action) => serializeContentAgentAction(action))}
      agentConfig={contentAgentConfig()}
    />
  ) : (
    <div className="mx-auto flex h-[calc(100vh-140px)] max-w-3xl items-center">
      <EmptyState
        title="还没有 Ozon 店铺"
        description="先在店铺设置里连接 Ozon，再运行内容 Agent。"
      >
        <div className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-900 px-3 text-sm font-medium text-white">
          <Bot className="h-4 w-4" aria-hidden="true" />
          等待店铺数据
        </div>
      </EmptyState>
    </div>
  );
}
