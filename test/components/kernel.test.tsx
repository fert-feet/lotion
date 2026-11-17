// @vitest-environment jsdom
// 客户端内核集成测试：真实 React 挂载下，组件经 useDocStore() 走 REST 接缝取数据、
// 经 useSlot() 渲染插件贡献的 UI —— 证明"UI 不再直接 import 数据模块"这条链路成立。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
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

describe("UI 插槽与内建 AI 面板的边界", () => {
  it("AI 面板由 AppShell 直接拥有，不再有内置 UI 插件清单", async () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const shell = fs.readFileSync(path.join(root, "src/shell/app-shell.tsx"), "utf8");
    const slots = fs.readFileSync(path.join(root, "src/shell/ui-plugins.tsx"), "utf8");
    expect(shell).toContain("<LazyAiPanel />");
    expect(shell).not.toContain("useHasSlot");
    expect(shell).not.toContain("SLOT_DETAILS_PANEL");
    expect(slots).not.toContain("shellUiPlugins");
    expect(slots).not.toContain("ai-panel");
  });

  it("没有 UI 插件时插槽为空（渲染方不需要知道有哪些插件）", async () => {
    const { bootClientKernel, _resetClientKernelForTest: reset } = await import("@/src/kernel/client");
    reset();

    const kernel = bootClientKernel();
    await kernel.ready;

    expect(kernel.uiSlots.get("details.panel")).toBeUndefined();
    reset();
  });
});
