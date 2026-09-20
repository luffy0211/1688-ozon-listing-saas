import { describe, expect, it } from "vitest";
import { visibleNavItemsForRole } from "./app-shell";

describe("app shell navigation", () => {
  it("keeps customer navigation focused on business work", () => {
    const labels = visibleNavItemsForRole("member").map((item) => item.label);

    expect(labels).toEqual([
      "运营 Agent",
      "上架工作台",
      "商品体检",
      "BI 看板",
      "任务中心",
      "待审批",
    ]);
  });

  it("keeps platform management entries for admins", () => {
    const labels = visibleNavItemsForRole("admin").map((item) => item.label);

    expect(labels).toContain("平台后台");
  });
});
