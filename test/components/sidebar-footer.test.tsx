// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { KernelProvider } from "@/src/kernel/react";
import { UserProvider } from "@/hooks/use-user";
import { SidebarFooter } from "@/src/shell/sidebar/sidebar-footer";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
  root = null;
  host = null;
});

async function renderFooter(rail = false) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const onBatchMode = vi.fn();
  await act(async () => {
    root!.render(
      <KernelProvider>
        <UserProvider
          initialUser={{
            id: "u1",
            email: "tester@example.com",
            name: "测试用户",
          }}
        >
          <MemoryRouter>
            <SidebarFooter rail={rail} onBatchMode={onBatchMode} />
          </MemoryRouter>
        </UserProvider>
      </KernelProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { onBatchMode };
}

describe("SidebarFooter 工具栏", () => {
  it("水平工具栏只有一个 Tab 停点，方向键移动并在头像中展示身份", async () => {
    await renderFooter();
    const toolbar = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="侧边栏操作"]')!;
    expect(toolbar.getAttribute("aria-orientation")).toBe("horizontal");
    expect(toolbar.getAttribute("aria-labelledby")).toBeNull();

    const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "设置",
      "回收站",
      "更多侧边栏操作",
      "账户菜单：测试用户",
    ]);
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    expect(buttons[3].textContent).toContain("测");

    await act(async () => {
      buttons[0].focus();
      toolbar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("批量操作收进更多浮层，不再与设置/回收站平铺", async () => {
    const { onBatchMode } = await renderFooter();
    const more = document.querySelector<HTMLButtonElement>(
      'button[aria-label="更多侧边栏操作"]',
    )!;
    await act(async () => {
      more.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const batch = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("批量选择笔记"),
    )!;
    expect(batch).toBeTruthy();
    await act(async () => batch.click());
    expect(onBatchMode).toHaveBeenCalledTimes(1);
  });

  it("rail 使用纵向工具栏语义", async () => {
    await renderFooter(true);
    const toolbar = document.querySelector<HTMLElement>('[role="toolbar"]')!;
    expect(toolbar.getAttribute("aria-orientation")).toBe("vertical");
  });
});
