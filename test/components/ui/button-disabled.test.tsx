// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

let host: HTMLDivElement | null = null;

afterEach(() => {
  host?.remove();
  host = null;
});

describe("Button 禁用态", () => {
  it("使用中性背景和可读文字，不再把整个按钮降到 40% 透明度", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <Button variant="destructive" disabled>
          删除
        </Button>,
      );
    });
    const button = host.querySelector("button")!;
    expect(button.disabled).toBe(true);
    expect(button.className).toContain("disabled:bg-secondary");
    expect(button.className).toContain("disabled:text-shell-label-placeholder");
    expect(button.className).not.toContain("disabled:opacity-40");
    act(() => root.unmount());
  });
});
