import { describe, expect, it } from "vitest";
import { buildAgentExecutionTrace, buildAgentPlan, buildPendingAgentExecutionTrace } from "./execution-trace";

describe("agent execution trace", () => {
  it("plans competitor analysis as a controlled workflow", () => {
    const plan = buildAgentPlan({
      prompt: "根据我的店铺商品做一次竞品分析，每个二级类目分析 5 个商品数据。",
      requiredToolName: "analyze_ozon_competitors",
      competitorsPerCategory: 5,
    });

    expect(plan.map((step) => step.kind)).toEqual([
      "RECEIVE_TASK",
      "PLAN_TASK",
      "READ_STORE_SNAPSHOT",
      "COLLECT_COMPETITORS",
      "SUMMARIZE_CATEGORY_PLAYBOOK",
      "DIAGNOSE_PRODUCTS",
      "CREATE_ACTIONS",
      "WAIT_FOR_APPROVAL",
    ]);
  });

  it("turns tool calls into user-visible step statuses", () => {
    const plan = buildAgentPlan({
      prompt: "竞品分析，每个类目 5 个竞品",
      requiredToolName: "analyze_ozon_competitors",
      competitorsPerCategory: 5,
    });
    const trace = buildAgentExecutionTrace({
      plan,
      createdActionIds: ["action-1"],
      runStatus: "SUCCEEDED",
      toolCalls: [
        {
          name: "get_ozon_store_snapshot",
          at: "2026-09-17T01:00:00.000Z",
          output: { storeName: "测试店铺", productCount: 20, visibleProductCount: 10 },
        },
        {
          name: "analyze_ozon_competitors",
          at: "2026-09-17T01:00:10.000Z",
          output: {
            competitorCount: 15,
            analyzedProductCount: 20,
            categories: ["Поло", "Рубашка"],
          },
        },
      ],
    });

    expect(trace.find((step) => step.id === "read-store")?.status).toBe("succeeded");
    expect(trace.find((step) => step.id === "collect-competitors")?.outputSummary).toContain("竞品 15");
    expect(trace.find((step) => step.id === "create-actions")?.status).toBe("succeeded");
    expect(trace.find((step) => step.id === "wait-approval")?.status).toBe("waiting");
  });

  it("marks downstream steps skipped after tool failure", () => {
    const plan = buildAgentPlan({
      prompt: "检查 offerId F18260807vo-0A-XL",
      requiredToolName: "get_ozon_product_content",
      offerId: "F18260807vo-0A-XL",
    });
    const trace = buildAgentExecutionTrace({
      plan,
      runStatus: "FAILED",
      toolCalls: [
        {
          name: "get_ozon_product_content",
          at: "2026-09-17T01:00:00.000Z",
          input: { offerId: "F18260807vo-0A-XL" },
          error: "Ozon API returned 400",
        },
      ],
    });

    expect(trace.find((step) => step.id === "read-product")?.status).toBe("failed");
    expect(trace.find((step) => step.id === "create-actions")?.status).toBe("skipped");
  });

  it("builds a pending trace immediately for the chat UI", () => {
    const trace = buildPendingAgentExecutionTrace("根据我的店铺商品做一次竞品分析，每个二级类目分析 5 个商品数据");

    expect(trace.map((step) => step.id)).toContain("collect-competitors");
    expect(trace[0]?.status).toBe("succeeded");
    expect(trace[1]?.status).toBe("running");
    expect(trace.find((step) => step.id === "collect-competitors")?.status).toBe("pending");
  });
});
