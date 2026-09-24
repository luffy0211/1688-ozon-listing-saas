import { describe, expect, it } from "vitest";

import { shouldSubmitChatKey } from "./content-agent-chat";

describe("content agent IME input", () => {
  it("does not submit Enter while Chinese composition is active", () => {
    expect(shouldSubmitChatKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  });

  it("submits plain Enter and keeps Shift+Enter for a new line", () => {
    expect(shouldSubmitChatKey({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
    expect(shouldSubmitChatKey({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
  });
});
