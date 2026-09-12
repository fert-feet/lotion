// @vitest-environment jsdom
// 客户端内核集成测试：真实 React 挂载下，组件经 useDocStore() 走 REST 接缝取数据、
// 经 useSlot() 渲染插件贡献的 UI —— 证明"UI 不再直接 import 数据模块"这条链路成立。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Context as KernelContext, PluginEntry } from "@/lib/kernel";
import { requireUiSlots } from "@/lib/seams/ui-slots";
import type { UiDocStore } from "@/lib/seams/doc-store";
import { KernelProvider, useDocStore, useSlot } from "@/src/kernel/react";
import { _resetClientKernelForTest } from "@/src/kernel/client";

let container: HTMLDivElement;
let root: Root;

/** 只 mock 侧边栏列表端点：验证组件确实通过内核的 docStore(REST) 取数 */
function mockSidebar(rows: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/documents?scope=sidebar")) {
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }),
  );
}

/** 消费组件：从内核取 docStore（REST）与插件贡献的插槽内容 */
function Consumer() {
  const store = useDocStore();
  const [titles, setTitles] = useState<string[]>([]);
  const panel = useSlot("details.panel");

  useEffect(() => {
    void store.listSidebarAll({ userId: "u1" }).then((rows) => setTitles(rows.map((row) => row.title)));
  }, [store]);

  return (
    <div>
      <span data-testid="titles">{titles.join(",")}</span>
      <span data-testid="panel">{panel}</span>
    </div>
  );
}

async function mount(extraPlugins: PluginEntry[] = []) {
  await act(async () => {
    root.render(
      <KernelProvider options={{ extraPlugins }}>
        <Consumer />
      </KernelProvider>,
    );
  });
  // 等 mock fetch 的 promise 落地并触发一次渲染
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** 造一个贡献 UI 的插件（证明"UI 插件 → 插槽 → 渲染"这条链路） */
function panelPlugin(component: ReactNode): PluginEntry {
  return {
    id: "ui-demo",
    plugin: {
      name: "ui-demo",
      inject: ["uiSlots"],
      apply: (ctx: KernelContext) => {
        requireUiSlots<ReactNode>(ctx).register({
          id: "demo-panel",
          slot: "details.panel",
          kind: "single",
          component,
        });
      },
    },
  };
}

beforeEach(() => {
  _resetClientKernelForTest();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  _resetClientKernelForTest();
  vi.unstubAllGlobals();
});

describe("src/kernel 客户端内核", () => {
  it("组件经 useDocStore() 取数据（走 REST 接缝，而不是直接 import @/lib/db）", async () => {
    mockSidebar([
      { id: "d1", title: "路线图" },
      { id: "d2", title: "周报" },
    ]);

    await mount();

    expect(container.querySelector('[data-testid="titles"]')?.textContent).toBe("路线图,周报");
  });

  it("UI 插件贡献的插槽内容被消费组件渲染出来", async () => {
    mockSidebar([]);

    await mount([panelPlugin(<strong>插件贡献的面板</strong>)]);

    expect(container.querySelector('[data-testid="panel"]')?.textContent).toBe("插件贡献的面板");
  });

  it("未贡献的插槽渲染为空（渲染方不需要知道有哪些插件）", async () => {
    mockSidebar([]);

    await mount();

    expect(container.querySelector('[data-testid="panel"]')?.textContent).toBe("");
  });

  it("docStore 的 UI 子集不含宿主独有写操作（浏览器侧契约边界）", async () => {
    mockSidebar([]);
    let keys: string[] = [];

    function Probe() {
      const store = useDocStore() as unknown as Record<string, unknown> & UiDocStore;
      keys = Object.keys(store);
      return null;
    }

    await act(async () => {
      root.render(
        <KernelProvider>
          <Probe />
        </KernelProvider>,
      );
    });

    expect(keys).toContain("listSidebarAll");
    expect(keys).not.toContain("insertChatMessage");
  });
});

describe("src/shell/ui-plugins 内置 UI 插件清单", () => {
  it("shellUiPlugins 把 AI 面板注册进 details.panel 插槽（AppShell 不再硬编码面板）", async () => {
    const { shellUiPlugins, SLOT_DETAILS_PANEL } = await import("@/src/shell/ui-plugins");
    const { bootClientKernel, _resetClientKernelForTest: reset } = await import("@/src/kernel/client");
    reset();

    const kernel = bootClientKernel({ extraPlugins: shellUiPlugins() });

    expect(kernel.load.mounted.map((m) => m.id)).toContain("ui-ai-panel");
    expect(kernel.uiSlots.get(SLOT_DETAILS_PANEL)).toBeDefined();
    expect(kernel.uiSlots.entries().map((e) => e.id)).toEqual(["ai-panel"]);
    reset();
  });

  it("没有 UI 插件时插槽为空（渲染方不需要知道有哪些插件）", async () => {
    const { bootClientKernel, _resetClientKernelForTest: reset } = await import("@/src/kernel/client");
    const { SLOT_DETAILS_PANEL } = await import("@/src/shell/ui-plugins");
    reset();

    const kernel = bootClientKernel();

    expect(kernel.uiSlots.get(SLOT_DETAILS_PANEL)).toBeUndefined();
    reset();
  });
});
