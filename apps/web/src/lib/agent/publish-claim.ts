import { prisma } from "@saas/db";

// Every publisher must claim before submitting; never delete an uncertain claim.
export async function claimPublishRun(params: {
  tenantId: string;
  draftId: string;
  storeId: string;
  requestHash: string;
  request: unknown;
}) {
  try {
    return await prisma.publishRun.create({
      data: {
        tenantId: params.tenantId,
        draftId: params.draftId,
        storeId: params.storeId,
        requestHash: params.requestHash,
        requestJson: params.request as never,
        status: "submitting",
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new Error("duplicate_submission");
    }
    throw error;
  }
}
