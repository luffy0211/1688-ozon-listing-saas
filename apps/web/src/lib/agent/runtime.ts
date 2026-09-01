import { Agent, Runner, tool } from "@openai/agents";
import { AgentActionType, AgentRiskLevel, AgentRunStatus, prisma } from "@saas/db";
import { z } from "zod";
import { env } from "@/lib/env";
import { createAgentActions, type ProposedAgentAction } from "./actions";
import { extractOfferId, extractOzonUrls } from "./chat-input";
import { runCompetitorContentAgent } from "./competitor-content";
import { getProfitGuardrails, redactSensitiveText } from "./policy";
import { getAgentStoreSnapshot } from "./snapshot";

const actionTypeSchema = z.enum([
  "UPDATE_PRICE",
  "UPDATE_STOCK",
  "UPDATE_IMAGES",
  "UPDATE_ATTRIBUTES",
  "UPDATE_CATEGORY",
  "PUBLISH_DRAFT",
  "CONTENT_DRAFT",
  "ARCHIVE_PRODUCT",
  "UNARCHIVE_PRODUCT",
  "DELETE_PRODUCT",
  "BULK_PRODUCT_UPDATE",
  "RESTOCK_RECOMMENDATION",
  "PROMO_RECOMMENDATION",
]);

const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

const actionSchema = z.object({
  type: actionTypeSchema,
  title: z.string().min(1).max(240),
  rationale: z.string().min(1).max(2000),
  riskLevel: riskLevelSchema.optional(),
  storeId: z.string().nullable().optional(),
  offerId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

function titleFromPrompt(prompt: string) {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 36 ? `${trimmed.slice(0, 36)}...` : trimmed || "Ozon Agent";
}

function toPlainAction(action: ProposedAgentAction) {
  return {
    ...action,
    riskLevel: action.riskLevel ?? "MEDIUM",
    payload: action.payload ?? {},
  };
}

async function ensureSession(params: {
  tenantId: string;
  userId: string;
  sessionId?: string | null;
  prompt: string;
}) {
  if (params.sessionId) {
    const existing = await prisma.agentSession.findFirst({
      where: {
        id: params.sessionId,
        tenantId: params.tenantId,
      },
    });
    if (existing) return existing;
  }

  return prisma.agentSession.create({
    data: {
      tenantId: params.tenantId,
      title: titleFromPrompt(params.prompt),
      createdBy: params.userId,
    },
  });
}

function buildInstructions() {
  const guardrails = getProfitGuardrails();
  return [
    "读取类操作可以直接调用真实工具，不需要人工确认。",
    "任何新增、删除、修改、发布、归档、价格或内容变更都必须先生成待人工确认的 action/draft，未批准前不能执行，不能声称已经执行。",
    "自家 Ozon 店铺数据必须按实时数据处理：回答店铺商品、库存、订单、草稿相关问题前，必须调用 get_store_snapshot，并让它刷新 Ozon API 数据；不能只依赖旧的本地快照。",
    "涉及自家店铺概况时，回复必须明确给出 Ozon 商品总数、可售商品数、总库存和同步时间。",
    "你是 Ozon 跨境电商运营 Agent，回复必须使用中文。",
    "你的目标是分析 Ozon 店铺运营和竞品内容，结合商品、库存、订单、草稿和 1688 成本估算提出运营动作。",
    "竞品内容建议必须区分直接复用、借鉴改写、需要确认、禁止使用；不能复制竞品图片、评论、品牌词或独特口号。",
    `改价建议必须满足毛利率 >= ${guardrails.minMarginRate * 100}% 且单件利润 >= ${guardrails.minProfitRub} RUB。缺少成本时，可以给建议价，但不能创建真实改价审批动作。`,
    "库存、图片、属性、类目、删除和批量商品修改可以创建待人工确认的 action，但未确认前不能执行；促销和广告花费暂时只做建议。",
    "不要请求、输出或推测 Ozon API Key、1688 Cookie、用户密码等敏感信息。",
    "需要落库的动作必须调用 propose_operational_actions；最终回复要总结判断、列出已创建动作和被阻断原因。",
  ].join("\n");
}

function buildInput(prompt: string, history: Array<{ role: string; content: string }>) {
  const recentHistory = history
    .slice(-8)
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");
  return [
    recentHistory ? `最近对话:\n${recentHistory}` : "",
    `用户最新请求:\n${prompt}`,
    "请先读取运营快照，再决定是否创建动作草案。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function resolveOwnProductReference(params: {
  tenantId: string;
  storeId?: string | null;
  sourceProductId?: string | null;
  prompt: string;
}) {
  if (params.sourceProductId) {
    const product = await prisma.sourceProduct.findFirst({
      where: { tenantId: params.tenantId, id: params.sourceProductId },
      select: { id: true, offerId: true },
    });
    if (product) {
      return { found: true, sourceProductId: product.id, offerId: product.offerId };
    }
  }

  const offerId = extractOfferId(params.prompt);
  if (!offerId) {
    return { found: false, sourceProductId: null, offerId: null };
  }

  const sourceProduct = await prisma.sourceProduct.findFirst({
    where: { tenantId: params.tenantId, offerId },
    select: { id: true, offerId: true },
  });
  if (sourceProduct) {
    return {
      found: true,
      sourceProductId: sourceProduct.id,
      offerId: sourceProduct.offerId,
    };
  }

  const snapshot = await prisma.ozonProductSnapshot.findFirst({
    where: {
      tenantId: params.tenantId,
      offerId,
      ...(params.storeId ? { storeId: params.storeId } : {}),
    },
    select: { offerId: true },
  });
  return {
    found: Boolean(snapshot),
    sourceProductId: null,
    offerId,
  };
}

async function runMockAgent(params: {
  tenantId: string;
  userId: string;
  sessionId: string;
  runId: string;
  storeId?: string | null;
  refreshOzonData?: boolean;
}) {
  const snapshot = await getAgentStoreSnapshot({
    tenantId: params.tenantId,
    userId: params.userId,
    storeId: params.storeId,
    refreshOzonData: params.refreshOzonData,
  });
  const lowStock = snapshot.products
    .filter((product) => product.visible && !product.archived && product.stock <= 5)
    .slice(0, 5);
  const draft = snapshot.compiledDrafts[0];

  const proposed: ProposedAgentAction[] = [
    ...lowStock.map((product) => ({
      type: AgentActionType.RESTOCK_RECOMMENDATION,
      title: `补货检查：${product.name ?? product.offerId}`,
      rationale: `当前库存 ${product.stock}，预留 ${product.reservedStock}，需要结合 FBS/FBO 履约方式优先确认补货或下架节奏。`,
      riskLevel: AgentRiskLevel.LOW,
      storeId: snapshot.store?.id,
      offerId: product.offerId,
      productId: product.productId,
      payload: {
        currentStock: product.stock,
        reservedStock: product.reservedStock,
        fulfillmentScope: "FBS/FBO",
      },
    })),
    ...(draft
      ? [
          {
            type: AgentActionType.PUBLISH_DRAFT,
            title: `发布草稿：${draft.titleRu ?? draft.offerId}`,
            rationale:
              "已有编译完成的 Ozon 草稿，可以进入人工审批；真实发布仍由后续执行器受 ENABLE_REAL_OZON_SUBMIT 控制。",
            riskLevel: AgentRiskLevel.MEDIUM,
            storeId: snapshot.store?.id,
            offerId: draft.offerId,
            productId: draft.productId,
            payload: {
              draftId: draft.id,
              priceRub: draft.priceRub,
              ozonCategoryId: draft.ozonCategoryId,
            },
          } satisfies ProposedAgentAction,
        ]
      : []),
  ];

  const actions = await createAgentActions({
    tenantId: params.tenantId,
    sessionId: params.sessionId,
    runId: params.runId,
    requestedBy: params.userId,
    actions: proposed,
  });

  const output = [
    snapshot.store
      ? `我看了 ${snapshot.store.name} 的最新运营快照。`
      : "还没有可用的 Ozon 店铺快照。",
    lowStock.length
      ? `低库存商品 ${lowStock.length} 个，已生成补货/下架节奏建议。`
      : "暂时没有发现库存小于等于 5 的可售商品。",
    draft ? "发现 1 个可发布草稿，已创建发布审批动作。" : "没有找到可发布草稿。",
    actions.some((item) => item.status === "BLOCKED")
      ? "部分动作因为利润或成本 guardrail 被阻断。"
      : "所有动作都按当前 guardrail 处理完毕。",
  ].join("\n");

  const latestSnapshot = snapshot.latestSnapshot;
  const realtimeOutput = [
    snapshot.store
      ? `我已实时调用 Ozon API 读取 ${snapshot.store.name} 的店铺数据。`
      : "还没有可用的 Ozon 店铺数据。",
    latestSnapshot
      ? `当前 Ozon 商品数：${latestSnapshot.productCount} 个；可售商品：${latestSnapshot.visibleProductCount} 个；已归档：${latestSnapshot.archivedProductCount} 个；总库存：${latestSnapshot.totalStock}。`
      : "还没有生成 Ozon 运营快照。",
    latestSnapshot
      ? `同步时间：${new Date(latestSnapshot.syncedAt).toLocaleString("zh-CN")}。`
      : "",
    lowStock.length
      ? `低库存商品 ${lowStock.length} 个，已生成补货/下架节奏建议。`
      : "暂时没有发现库存小于等于 5 的可售商品。",
    draft ? "发现 1 个可发布草稿，已创建发布审批动作。" : "没有找到可发布草稿。",
    actions.some((item) => item.status === "BLOCKED")
      ? "部分动作因为利润或成本 guardrail 被阻断。"
      : "所有动作都按当前 guardrail 处理完毕。",
    latestSnapshot?.error ? `同步提示：${latestSnapshot.error}` : "",
  ].filter(Boolean).join("\n");

  return { output: realtimeOutput || output, actions };
}

export async function runOzonOpsAgent(params: {
  tenantId: string;
  userId: string;
  prompt: string;
  sessionId?: string | null;
  storeId?: string | null;
  refreshOzonData?: boolean;
  sourceProductId?: string | null;
  competitorUrls?: string[];
}) {
  const prompt = redactSensitiveText(params.prompt);
  const refreshOzonData = true;
  const competitorUrls = [
    ...new Set(
      [...(params.competitorUrls ?? []), ...extractOzonUrls(prompt)]
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ];
  const session = await ensureSession({
    tenantId: params.tenantId,
    userId: params.userId,
    sessionId: params.sessionId,
    prompt,
  });

  await prisma.agentMessage.create({
    data: {
      tenantId: params.tenantId,
      sessionId: session.id,
      role: "USER",
      content: prompt,
      metaJson: {
        storeId: params.storeId,
        refreshOzonData,
        sourceProductId: params.sourceProductId,
        competitorUrls,
      } as never,
    },
  });

  const runRecord = await prisma.agentRun.create({
    data: {
      tenantId: params.tenantId,
      sessionId: session.id,
      requestedBy: params.userId,
      status: AgentRunStatus.RUNNING,
      model:
        env.openaiAgentMock || !env.openaiApiKey
          ? "local-mock"
          : env.openaiAgentModel || "sdk-default",
      input: prompt,
    },
  });

  try {
    if (competitorUrls.length > 0) {
      const ownProduct = await resolveOwnProductReference({
        tenantId: params.tenantId,
        storeId: params.storeId,
        sourceProductId: params.sourceProductId,
        prompt,
      });

      if (!ownProduct.found) {
        const output = ownProduct.offerId
          ? `我识别到了竞品链接，也看到了 offerId ${ownProduct.offerId}，但在商品池或 Ozon 商品快照里没有找到这个自家商品。请先导入/同步这个商品，或者换一个已经存在的 offerId。`
          : "我识别到了竞品链接。为了做有效对比，请同时告诉我自家商品的 offerId，例如：分析 offerId ABC123，对比 https://www.ozon.ru/product/...";
        await finishAgentRun({
          tenantId: params.tenantId,
          sessionId: session.id,
          runId: runRecord.id,
          output,
        });
        return { sessionId: session.id, runId: runRecord.id, output, actions: [] };
      }

      const result = await runCompetitorContentAgent({
        tenantId: params.tenantId,
        userId: params.userId,
        sessionId: session.id,
        runId: runRecord.id,
        storeId: params.storeId,
        sourceProductId: ownProduct.sourceProductId,
        offerId: ownProduct.offerId,
        competitorUrls,
      });
      await finishAgentRun({
        tenantId: params.tenantId,
        sessionId: session.id,
        runId: runRecord.id,
        output: result.output,
      });
      return { sessionId: session.id, runId: runRecord.id, ...result };
    }

    if (env.openaiAgentMock || !env.openaiApiKey) {
      const result = await runMockAgent({
        tenantId: params.tenantId,
        userId: params.userId,
        sessionId: session.id,
        runId: runRecord.id,
        storeId: params.storeId,
        refreshOzonData,
      });
      await finishAgentRun({
        tenantId: params.tenantId,
        sessionId: session.id,
        runId: runRecord.id,
        output: result.output,
      });
      return { sessionId: session.id, runId: runRecord.id, ...result };
    }

    const history = await prisma.agentMessage.findMany({
      where: { tenantId: params.tenantId, sessionId: session.id },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { role: true, content: true },
    });

    const getSnapshotTool = tool({
      name: "get_store_snapshot",
      description:
        "Read a sanitized Ozon operations snapshot for the current tenant. It never returns API keys, cookies, or raw secrets.",
      parameters: z.object({
        storeId: z.string().nullable().optional(),
        refreshOzonData: z.boolean().optional(),
      }),
      execute: async ({ storeId, refreshOzonData }) =>
        getAgentStoreSnapshot({
          tenantId: params.tenantId,
          userId: params.userId,
          storeId: storeId ?? params.storeId,
          refreshOzonData: refreshOzonData ?? true,
        }),
    });

    const proposeActionsTool = tool({
      name: "propose_operational_actions",
      description:
        "Persist proposed Ozon operations actions. Price updates are blocked unless profit guardrails pass. Inventory and promotion actions are recommendation-only.",
      parameters: z.object({
        actions: z.array(actionSchema).max(20),
      }),
      execute: async ({ actions }) => {
        const created = await createAgentActions({
          tenantId: params.tenantId,
          sessionId: session.id,
          runId: runRecord.id,
          requestedBy: params.userId,
          actions: actions.map((action) => ({
            ...action,
            type: action.type as AgentActionType,
            riskLevel: action.riskLevel as AgentRiskLevel | undefined,
            payload: action.payload,
          })),
        });
        return {
          created: created.map((item) => ({
            id: item.id,
            type: item.type,
            status: item.status,
            riskLevel: item.riskLevel,
            title: item.title,
            error: item.error,
          })),
        };
      },
    });

    const agent = new Agent({
      name: "Ozon Operations Agent",
      ...(env.openaiAgentModel ? { model: env.openaiAgentModel } : {}),
      instructions: buildInstructions(),
      tools: [getSnapshotTool, proposeActionsTool],
    });
    const runner = new Runner({
      tracingDisabled: !env.openaiAgentTraceSensitiveData,
    });
    const result = await runner.run(agent, buildInput(prompt, history), {
      maxTurns: 6,
    });
    const output = String(result.finalOutput ?? "Agent 没有返回内容。");
    await finishAgentRun({
      tenantId: params.tenantId,
      sessionId: session.id,
      runId: runRecord.id,
      output,
      toolCallsJson: { historyCount: history.length },
    });
    const actions = await prisma.agentAction.findMany({
      where: { tenantId: params.tenantId, runId: runRecord.id },
      orderBy: { createdAt: "asc" },
    });
    return { sessionId: session.id, runId: runRecord.id, output, actions };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.agentRun.update({
      where: { id: runRecord.id },
      data: {
        status: AgentRunStatus.FAILED,
        error: message,
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}

async function finishAgentRun(params: {
  tenantId: string;
  sessionId: string;
  runId: string;
  output: string;
  toolCallsJson?: unknown;
}) {
  await prisma.$transaction([
    prisma.agentRun.update({
      where: { id: params.runId },
      data: {
        status: AgentRunStatus.SUCCEEDED,
        output: params.output,
        toolCallsJson: params.toolCallsJson as never,
        finishedAt: new Date(),
      },
    }),
    prisma.agentMessage.create({
      data: {
        tenantId: params.tenantId,
        sessionId: params.sessionId,
        role: "ASSISTANT",
        content: params.output,
        metaJson: { runId: params.runId } as never,
      },
    }),
  ]);
}

export function serializeAgentAction(action: {
  id: string;
  type: string;
  status: string;
  riskLevel: string;
  title: string;
  rationale: string;
  storeId: string | null;
  offerId: string | null;
  productId: string | null;
  payloadJson: unknown;
  guardrailJson: unknown;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: action.id,
    type: action.type,
    status: action.status,
    riskLevel: action.riskLevel,
    title: action.title,
    rationale: action.rationale,
    storeId: action.storeId,
    offerId: action.offerId,
    productId: action.productId,
    payload: action.payloadJson,
    guardrail: action.guardrailJson,
    error: action.error,
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
  };
}

export function serializeAgentResult(result: Awaited<ReturnType<typeof runOzonOpsAgent>>) {
  return {
    sessionId: result.sessionId,
    runId: result.runId,
    output: result.output,
    actions: result.actions.map((action) => serializeAgentAction(action)),
  };
}

export function plainProposedAction(action: ProposedAgentAction) {
  return toPlainAction(action);
}
