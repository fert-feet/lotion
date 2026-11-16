// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("DropdownMenu 键盘行为", () => {
  it("打开后聚焦首项，方向键移动，Enter 触发当前项", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onSecond = vi.fn();

    await act(async () => {
      root!.render(
        <DropdownMenu>
          <DropdownMenuTrigger asChild={false}>打开</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>第一项</DropdownMenuItem>
            <DropdownMenuItem onClick={onSecond}>第二项</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
    });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(menu).not.toBeNull();
    expect(items).toHaveLength(2);
    expect(document.activeElement).toBe(items[0]);

    await act(async () => {
      menu!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(items[1]);

    await act(async () => {
      menu!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSecond).toHaveBeenCalledTimes(1);
  });
});
