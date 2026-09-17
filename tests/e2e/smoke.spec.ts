import { expect, test } from "@playwright/test";

test("login page renders the public entry point", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "邮箱" })).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
  await expect(page.getByRole("button", { name: "进入工作台" })).toBeVisible();
});
