import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  agentAction: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

vi.mock("@saas/db", () => ({
  prisma,
  AgentActionStatus: {
    APPROVED: "APPROVED",
    EXECUTED: "EXECUTED",
    FAILED: "FAILED",
    PENDING_APPROVAL: "PENDING_APPROVAL",
    RECOMMENDED: "RECOMMENDED",
    BLOCKED: "BLOCKED",
  },
  AgentRiskLevel: {
    MEDIUM: "MEDIUM",
  },
}));

import { executeApprovedAgentAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENABLE_REAL_OZON_SUBMIT = "false";
});

describe("executeApprovedAgentAction", () => {
  it("does not mark approved content drafts as executed without a real Ozon write", async () => {
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "action-1",
      tenantId: "tenant-1",
      type: "CONTENT_DRAFT",
      status: "APPROVED",
      guardrailJson: {},
    });
    prisma.agentAction.update.mockResolvedValue({
      id: "action-1",
      type: "CONTENT_DRAFT",
      status: "FAILED",
      error: "missing_store_id",
    });

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "action-1",
    });

    expect(result?.status).toBe("FAILED");
    expect(prisma.agentAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: {
        status: "FAILED",
        error: "missing_store_id",
      },
    });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not execute unapproved actions", async () => {
    const action = {
      id: "action-1",
      type: "CONTENT_DRAFT",
      status: "PENDING_APPROVAL",
    };
    prisma.agentAction.findFirst.mockResolvedValue(action);

    await expect(
      executeApprovedAgentAction({
        tenantId: "tenant-1",
        userId: "user-1",
        actionId: "action-1",
      }),
    ).resolves.toBe(action);
    expect(prisma.agentAction.update).not.toHaveBeenCalled();
  });

  it("fails approved mutating actions when no real executor exists", async () => {
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "action-2",
      tenantId: "tenant-1",
      type: "UPDATE_PRICE",
      status: "APPROVED",
    });
    prisma.agentAction.update.mockResolvedValue({
      id: "action-2",
      type: "UPDATE_PRICE",
      status: "FAILED",
      error: "missing_store_id",
    });

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "action-2",
    });

    expect(result?.status).toBe("FAILED");
    expect(prisma.agentAction.update).toHaveBeenCalledWith({
      where: { id: "action-2" },
      data: {
        status: "FAILED",
        error: "missing_store_id",
      },
    });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
