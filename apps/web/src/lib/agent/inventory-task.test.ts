import { describe, expect, it } from "vitest";

import { inventoryTargetFromPrompt } from "./inventory-task";

describe("inventory task target", () => {
  it("treats 补到20 as an absolute target", () => {
    expect(inventoryTargetFromPrompt("这三个每款补到20")).toEqual({
      mode: "set_total",
      value: 20,
    });
  });

  it("requires clarification for ambiguous 补20", () => {
    expect(inventoryTargetFromPrompt("这三个每款补20")).toEqual({
      mode: "ambiguous",
      value: 20,
    });
  });

  it("treats 增加20 as an increment", () => {
    expect(inventoryTargetFromPrompt("这三个每款增加20件")).toEqual({
      mode: "add",
      value: 20,
    });
  });
});
