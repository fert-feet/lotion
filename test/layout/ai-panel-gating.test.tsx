// @vitest-environment jsdom
// 禁用 ui-ai-panel 后，AI 的「入口」必须跟着插件一起消失。
//
// 背景（用户报障）：设置里禁用「AI 助手面板」→ 刷新后左上角 AI 按钮还在，点开是一列空白，
// 面板能"召唤"但没内容。根因不是单一按钮忘了判断，而是宿主与插件的所有权切错了：
// 详情列容器、呈现模式切换器、AI 按钮、⌘J 快捷键全在 shell 里硬编码，
// 插件只贡献了 slot 内容——所以「禁用」只等于「内容为空」。
// 现在 shell 用 useHasSlot(details.panel) 决定入口与容器是否成立。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { UserProvider } from "@/hooks/use-user";
import { useLayout } from "@/hooks/use-layout";
import { KernelProvider } from "@/src/kernel/react";
import { _resetClientKernelForTest } from "@/src/kernel/client";
import { shellUiPlugins } from "@/src/shell/ui-plugins";
import { routes } from "@/src/router";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // 内核是进程级单例，用例之间必须重置，否则组合清单互相污染
  _resetClientKernelForTest();
  useLayout.setState({
    sidebar: 264,
    details: 0,
    narrow: false,
    narrowExpanded: false,
  });
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

/** 挂载三栏外壳；disabledAi=true 时模拟用户在设置里禁用了 ui-ai-panel */
async function mountShell(options: { disabledAi: boolean }): Promise<HTMLDivElement> {
  const router = createMemoryRouter(routes, { initialEntries: ["/documents/d1"] });
  const plugins = shellUiPlugins(options.disabledAi ? { disabled: ["ui-ai-panel"] } : {});
  await act(async () => {
    root.render(
      <KernelProvider options={{ extraPlugins: plugins }}>
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
    if (candidate?.querySelector("[data-sidebar-header]") !== null && candidate !== null) {
      shell = candidate;
      break;
    }
  }
  expect(shell, "未渲染出三栏 shell").not.toBeNull();
  return shell!;
}

function pressJ(cmd = true, shift = false) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", metaKey: cmd, shiftKey: shift }));
  });
}

describe("禁用 AI 面板插件后，AI 入口与详情列一并消失", () => {
  it("启用时：AI 按钮在、details 列在（对照组，防止本组用例空转）", async () => {
    const shell = await mountShell({ disabledAi: false });

    expect(shell.querySelector('button[aria-label="AI 助手"]'), "启用时应有 AI 入口").not.toBeNull();
    expect(shell.querySelector("[data-details-column]"), "启用时应有详情列").not.toBeNull();
  });

  it("禁用后：没有 AI 按钮、没有详情列，只有正文两列", async () => {
    const shell = await mountShell({ disabledAi: true });

    expect(
      shell.querySelector('button[aria-label="AI 助手"]'),
      "插件已禁用，AI 入口不该还在（点了只会开出一列空白）",
    ).toBeNull();
    expect(shell.querySelector("[data-details-column]"), "没有面板贡献者就不该渲染详情列壳").toBeNull();
    // 外壳其余部分不受影响：市场 / 新建入口照常在
    expect(shell.querySelector('button[aria-label="插件市场"]')).not.toBeNull();
    expect(shell.querySelector('button[aria-label="新建笔记"]')).not.toBeNull();
  });

  it("禁用后 ⌘J 不再接管（不开空列、不改 details 状态）", async () => {
    const shell = await mountShell({ disabledAi: true });

    pressJ();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(useLayout.getState().details, "⌘J 不该把 details 打开").toBe(0);
    expect(shell.querySelector("[data-details-column]")).toBeNull();
  });

  it("启用时 ⌘J 仍能开合（对照）」", async () => {
    const shell = await mountShell({ disabledAi: false });
    const before = useLayout.getState().details;

    pressJ();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(useLayout.getState().details, "⌘J 应切换 details 开合").not.toBe(before);
    expect(shell.querySelector("[data-details-column]")).not.toBeNull();
  });
});
