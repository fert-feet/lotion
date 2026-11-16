import { describe, expect, it } from "vitest";
import { isImeConfirmingKey } from "@/lib/ime";

describe("isImeConfirmingKey", () => {
  it("识别原生 composition 状态", () => {
    expect(isImeConfirmingKey({ isComposing: true })).toBe(true);
    expect(isImeConfirmingKey({ isComposing: false })).toBe(false);
  });

  it("覆盖 Safari 的 keyCode 229 确认键", () => {
    expect(isImeConfirmingKey({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeConfirmingKey({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
