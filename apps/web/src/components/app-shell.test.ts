import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { vi } from "vitest";
import { visibleNavItemsForRole } from "./app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/agent/content" }));
afterEach(() => vi.unstubAllGlobals());

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
  });

  it("keeps admins out of the customer navigation surface", () => {
    const labels = visibleNavItemsForRole("admin").map((item) => item.label);

    expect(labels).not.toContain("平台后台");
  });

  it("shows the tenant credit balance in the customer shell", async () => {
    vi.stubGlobal("React", React);
    const { AppShell } = await import("./app-shell");
    const html = renderToStaticMarkup(React.createElement(AppShell, {
      user: { userId: "u1", tenantId: "t1", role: "owner", email: "customer@example.com" },
      children: React.createElement("div", null, "Agent"),
    }));
    expect(html).toContain("积分");
  });
});
