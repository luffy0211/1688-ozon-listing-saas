import { describe, expect, it } from "vitest";
import { canSeePlatformControls, visibleNavItemsForRole } from "./app-shell";

describe("app shell navigation", () => {
  it("keeps customer navigation focused on business work", () => {
    const labels = visibleNavItemsForRole("owner").map((item) => item.label);

    expect(labels).toEqual([
      "运营 Agent",
      "上架工作台",
      "商品体检",
      "BI 看板",
      "任务中心",
      "待审批",
    ]);
    expect(labels).not.toContain("平台后台");
    expect(canSeePlatformControls("owner")).toBe(false);
    expect(canSeePlatformControls("operator")).toBe(false);
  });

  it("keeps admins out of the customer navigation surface", () => {
    const labels = visibleNavItemsForRole("admin").map((item) => item.label);

    expect(labels).not.toContain("平台后台");
    expect(canSeePlatformControls("admin")).toBe(false);
  });
});
