// @vitest-environment jsdom
// 详情列（AI 面板）的布局不变量。
//
// 历史：「停靠 / 浮层 / 全屏」三种呈现模式已删除——同一功能三套行为、外加 ⌘⇧J 循环，
// 用户无法预期，实际使用里只用到停靠。现在只剩三栏停靠一种布局；
// 浮层不再是可选模式，而是让步链的兜底：窗口放不下三栏时 details 被压成 0，
// 此时改为右侧浮层 + 遮罩点击关闭，面板仍是同一个 React 位置（不重挂载、流式状态不丢）。
//
// jsdom 无布局引擎，故这里守**结构不变量**：网格轨道、浮层遮罩、以及"不再有模式切换器"。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { UserProvider } from "@/hooks/use-user";
import { useLayout } from "@/hooks/use-layout";
import { KernelProvider } from "@/src/kernel/react";
import { shellUiPlugins } from "@/src/shell/ui-plugins";
import { routes } from "@/src/router";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useLayout.setState({ sidebar: 280, details: 360, narrow: false, narrowExpanded: false });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me")) {
        return new Response(JSON.stringify({ user: { id: "u1", email: "u@x.com", name: null } }));
      }
      if (/\/api\/documents\/[^/?]+$/.test(url)) {
        return new Response(
          JSON.stringify({
            id: "d1",
            title: "布局测试",
            userId: "u1",
            isArchived: false,
            isDraft: false,
            parentDocument: null,
            content: null,
            coverImage: null,
            icon: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        );
      }
      return new Response(JSON.stringify([]));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 伪造帧宽：jsdom 没有布局引擎，ResizeObserver 与 getBoundingClientRect 都得给值 */
function stubViewport(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height: 900,
    top: 0,
    left: 0,
    right: width,
    bottom: 900,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe() {
        this.cb([], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

async function mountShell(): Promise<HTMLDivElement> {
  const router = createMemoryRouter(routes, { initialEntries: ["/documents/d1"] });
  await act(async () => {
    root.render(
      <KernelProvider options={{ extraPlugins: shellUiPlugins() }}>
        <UserProvider initialUser={null}>
          <RouterProvider router={router} />
        </UserProvider>
      </KernelProvider>,
    );
  });

  const deadline = Date.now() + 3000;
  let shell: HTMLDivElement | null = null;
  while (Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    const candidate = container.querySelector<HTMLDivElement>("div.grid");
    if (candidate && candidate.querySelector("[data-details-column]")) {
      shell = candidate;
      break;
    }
  }
  expect(shell, "未渲染出三栏 shell").not.toBeNull();
  return shell!;
}

/** 拆网格轨道：`minmax(0, 1fr)` 内部有空格，不能直接 split(" ") */
function tracks(shell: HTMLDivElement): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of shell.style.gridTemplateColumns) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

describe("详情列布局", () => {
  it("宽屏：details 是真实网格列，无遮罩", async () => {
    const shell = await mountShell();
    const cols = tracks(shell);
    expect(cols).toHaveLength(3);
    expect(cols[2]).toBe("360px");
    expect(shell.dataset.detailsOverlay).toBeUndefined();
    expect(shell.querySelector("[data-details-column]")?.getAttribute("data-details-overlay")).toBeNull();
  });

  it("窗口放不下三栏：details 压成 0 并降级为浮层，点遮罩关闭", async () => {
    stubViewport(1100); // 280 + 360 + 640 放不下 → 让步链把 details 压成 0
    const shell = await mountShell();

    expect(shell.dataset.detailsOverlay).toBe("true");
    expect(tracks(shell)[2], "浮层时 details 不占轨道").toBe("0px");
    expect(shell.querySelector("[data-details-column]")?.className).toContain("fixed");
    expect(shell.querySelector("[data-details-column]")?.getAttribute("role")).toBe("dialog");
    expect(shell.querySelector("[data-details-column]")?.getAttribute("aria-modal")).toBe("true");

    const scrim = container.querySelector<HTMLDivElement>("[data-details-scrim]");
    expect(scrim, "浮层兜底缺少点击关闭的遮罩").not.toBeNull();
    await act(async () => {
      scrim!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useLayout.getState().details, "点遮罩应当关闭面板").toBe(0);
  });

  it("浮层提供 Esc 关闭与焦点陷阱语义", async () => {
    stubViewport(1100);
    const shell = await mountShell();
    const panel = shell.querySelector<HTMLElement>("[data-details-column]");
    expect(panel).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(useLayout.getState().details).toBe(0);
    expect(shell.dataset.detailsOverlay).toBeUndefined();
  });

  it("不再有呈现模式：无切换器、无 data-details-mode、⌘⇧J 与 ⌘J 同义", async () => {
    const shell = await mountShell();

    expect(
      container.querySelector('[role="group"][aria-label="AI 面板呈现模式"]'),
      "呈现模式切换器应已随三模式一并删除",
    ).toBeNull();
    expect(shell.dataset.detailsMode).toBeUndefined();
    expect(shell.dataset.detailsFullscreen).toBeUndefined();

    const key = async (init: KeyboardEventInit) => {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, ...init }));
      });
    };

    // ⌘J 关闭 → ⌘⇧J 再打开（修饰键不再改变语义）
    await key({ metaKey: true });
    expect(useLayout.getState().details).toBe(0);
    await key({ metaKey: true, shiftKey: true });
    expect(useLayout.getState().details).toBeGreaterThan(0);
    expect(tracks(shell)[2], "重新打开后依旧是三栏停靠，不再铺满").not.toBe("0px");
  });

  it("分隔条可聚焦，方向键调整宽度，Home 恢复默认", async () => {
    const shell = await mountShell();
    const sidebarHandle = shell.querySelector<HTMLElement>(
      '[role="separator"][aria-label="调整侧边栏宽度"]',
    );
    expect(sidebarHandle?.tabIndex).toBe(0);
    expect(sidebarHandle?.getAttribute("aria-orientation")).toBe("vertical");

    const before = useLayout.getState().sidebar;
    await act(async () => {
      sidebarHandle!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(useLayout.getState().sidebar).toBe(before + 8);

    await act(async () => {
      sidebarHandle!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
    });
    expect(useLayout.getState().sidebar).toBe(280);
  });
});
