// @vitest-environment jsdom
// 侧边栏头部：插件市场入口在顶部 toolbar 图标组里（与 AI 助手 / 新建同排）。
//
// 背景：市场入口最初是一整行「图标 + 文字」按钮，压在标题行下方、占掉一行的树高；
// 现在收进 header 的 24px 图标组。这里守两件事：
//   1. 点击头部图标触发 onOpenMarket，且当前在 /market 时有 aria-current="page"；
//   2. 真实外壳里市场入口**只存在于 header**，不存在遗留的整行按钮（否则会重复入口）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { SidebarHeader } from "@/src/shell/sidebar/sidebar-header";
import { useLayout } from "@/hooks/use-layout";
import { UserProvider } from "@/hooks/use-user";
import { KernelProvider } from "@/src/kernel/react";
import { _resetClientKernelForTest, bootClientKernel } from "@/src/kernel/client";
import { shellUiPlugins } from "@/src/shell/ui-plugins";
import { routes } from "@/src/router";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  // 内核是进程级单例：每个用例都从干净的内核开始，否则上一个用例的
  // 组合清单（是否带 ui-ai-panel）会污染“有没有 AI 入口/详情列”的判定。
  _resetClientKernelForTest();
  // 全新 store 状态：避免上一个用例把 details 打开（AI 按钮会变成 ai 底色）
  useLayout.setState({ sidebar: 264, details: 0, narrow: false, narrowExpanded: false });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me")) {
        return new Response(JSON.stringify({ user: { id: "u1", email: "u@x.com", name: null } }));
      }
      return new Response(JSON.stringify([]));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function moreButton(scope: ParentNode): HTMLButtonElement | undefined {
  return scope.querySelector<HTMLButtonElement>('button[aria-label="更多侧边栏操作"]') ?? undefined;
}

function openMore(scope: ParentNode): HTMLElement {
  act(() => moreButton(scope)!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const item = document.querySelector<HTMLElement>('[role="menuitem"][aria-label="插件市场"]');
  expect(item, "更多菜单缺少插件市场入口").not.toBeNull();
  return item!;
}

describe("SidebarHeader 的插件市场按钮", () => {
  function renderHeader(overrides: Partial<Parameters<typeof SidebarHeader>[0]> = {}) {
    root = createRoot(container);
    const props = {
      query: "",
      onQueryChange: () => {},
      expanded: false,
      onExpandedChange: () => {},
      onCreate: () => {},
      onOpenMarket: () => {},
      ...overrides,
    };
    act(() => root.render(<SidebarHeader {...props} />));
    return props;
  }

  it("更多菜单里有「插件市场」入口，点击回调 onOpenMarket", () => {
    const onOpenMarket = vi.fn();
    renderHeader({ onOpenMarket });
    const item = openMore(container);
    act(() => item.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenMarket).toHaveBeenCalledTimes(1);
  });

  it("停在 /market 时 aria-current=page 高亮", () => {
    renderHeader({ marketActive: true });
    expect(openMore(container).getAttribute("aria-current")).toBe("page");

    act(() => root.unmount());
    container.innerHTML = "";
    document.body.querySelectorAll('[role="menuitem"]').forEach((node) => node.remove());
    renderHeader({ marketActive: false });
    expect(openMore(container).getAttribute("aria-current")).toBeNull();
  });

  it("一级操作保持搜索、更多、新建三项，AI 与市场收进更多菜单", async () => {
    // 头部现在按插槽有无决定是否渲染 AI 入口，所以先把带 ui-ai-panel 的内核装好
    await bootClientKernel({ extraPlugins: shellUiPlugins() }).ready;
    renderHeader();
    const header = container.querySelector("[data-sidebar-header]");
    expect(header, "头部根节点缺少 data-sidebar-header").not.toBeNull();

    const labels = [...header!.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["筛选当前文档树", "更多侧边栏操作", "新建笔记"]);
    act(() => moreButton(header!)!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.querySelector('[role="menuitem"][aria-label="AI 助手"]')).not.toBeNull();
    expect(document.querySelector('[role="menuitem"][aria-label="插件市场"]')).not.toBeNull();
  });

  it("没有「文档」小标题：这一行只剩可操作元素（搜索在左、操作在右）", () => {
    renderHeader();
    const header = container.querySelector<HTMLElement>("[data-sidebar-header]")!;
    // 去掉的是纯装饰的静态标题：它既不是工作区名也不是当前文档名
    expect(header.textContent?.includes("文档")).toBe(false);
    expect(header.className).toContain("justify-between");
    expect(
      header.firstElementChild?.querySelector('button[aria-label="筛选当前文档树"]'),
    ).toBeTruthy();
  });

  it("批量模式把头部切换为明确的选择状态", () => {
    renderHeader({ batchMode: true });
    const header = container.querySelector<HTMLElement>("[data-sidebar-header]")!;
    expect(header.textContent).toContain("选择笔记");
    expect(header.textContent).toContain("点击整行切换选择");
    expect(header.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("外壳里的市场入口位置", () => {
  /** 挂载 /documents/d1，等三栏与懒加载的 AI 面板就绪（同 height-chain.test.tsx 的轮询式等待） */
  async function mountShell(): Promise<HTMLDivElement> {
    root = createRoot(container);
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
      if (candidate && candidate.children[2]?.querySelector(".overflow-y-auto")) {
        shell = candidate;
        break;
      }
    }
    expect(shell, "未渲染出三栏 shell").not.toBeNull();
    return shell!;
  }

  it("市场入口只在侧边栏头部图标区，列表区不再有整行「插件市场」按钮", async () => {
    const shell = await mountShell();
    const sidebar = shell.children[0] as HTMLElement;

    const header = sidebar.querySelector("[data-sidebar-header]");
    expect(header, "侧边栏是 wide 形态，应存在头部").not.toBeNull();
    expect(openMore(header!), "头部更多菜单缺少插件市场入口").toBeTruthy();

    // wide 头部的一级入口只有搜索、更多、新建；rail 图标只存在于隐藏的另一层。
    expect(header!.querySelectorAll('button[aria-label="插件市场"]').length).toBe(0);

    // 旧实现是 <button><Store/><span>插件市场</span></button>：文字入口不该再存在
    const textEntry = [...sidebar.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "插件市场",
    );
    expect(textEntry, "列表区仍有整行「插件市场」入口（与头部重复）").toBeUndefined();
  });
});
