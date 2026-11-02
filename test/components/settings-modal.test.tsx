// @vitest-environment jsdom
// 设置弹窗：任意登录用户都能看到 外观/插件 两个标签（市场已移到侧边栏），插件页在固定高度容器里渲染。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRootContext } from "@/lib/kernel";
import { providePluginAdmin, type PluginInfo } from "@/lib/seams/plugins";
import { createUiSlots, provideUiSlots } from "@/lib/seams/ui-slots";
import { ThemeProvider } from "@/components/providers/theme-provider";
import SettingsModal from "@/components/modals/settings-modal";
import useSettings from "@/hooks/use-setting";
import { UserProvider } from "@/hooks/use-user";
import { KernelProvider } from "@/src/kernel/react";
import type { ClientKernel } from "@/src/kernel/client";
import { createPluginAdminStub } from "../mocks/plugin-admin";

let container: HTMLDivElement;
let root: Root;

const pluginInfo: PluginInfo = {
  id: "ui-ai-panel",
  title: "AI 助手面板",
  description: "详情栏面板",
  scope: "ui",
  source: "builtin",
  version: "0.1.0",
  enabled: true,
  approved: true,
  core: false,
  restartRequired: true,
  status: "active",
  config: {},
  configFields: [],
  capabilities: ["uiSlots"],
};

function kernelWith(admin: ReturnType<typeof createPluginAdminStub>): ClientKernel {
  const ctx = createRootContext();
  const uiSlots = createUiSlots<ReactNode>();
  provideUiSlots(ctx, uiSlots);
  providePluginAdmin(ctx, admin);
  return {
    ctx,
    uiSlots,
    load: {
      mounted: [],
      skipped: [],
      failed: [],
      unknownPatchIds: [],
      fibers: new Map(),
      dispose: async () => {},
    },
    ready: Promise.resolve(),
    startupText: "",
    dispose: async () => {},
  };
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((button) => button.textContent === label);
}

beforeEach(() => {
  useSettings.setState({ isOpen: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: { id: "u1", email: "owner@x.com", name: "Owner" },
          isOwner: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useSettings.setState({ isOpen: false });
  vi.unstubAllGlobals();
});

describe("SettingsModal", () => {
  it("非 owner 也能看到两个标签，插件页可渲染，市场不在设置里", async () => {
    const admin = createPluginAdminStub({
      list: vi.fn(async () => [pluginInfo]),
    });

    await act(async () => {
      root.render(
        <ThemeProvider attribute="class" defaultTheme="light">
          <KernelProvider kernel={kernelWith(admin)}>
            <UserProvider initialUser={null}>
              <SettingsModal />
            </UserProvider>
          </KernelProvider>
        </ThemeProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(findButton("外观")).toBeDefined();
    expect(findButton("插件")).toBeDefined();
    expect(findButton("市场")).toBeUndefined();

    await act(async () => {
      findButton("插件")?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(admin.list).toHaveBeenCalled();
    expect(document.body.textContent).toContain("AI 助手面板");
  });

  it("关闭按钮是真按钮、锚在右上角，导航里没有「设置」小标题", async () => {
    const admin = createPluginAdminStub({ list: vi.fn(async () => []) });

    await act(async () => {
      root.render(
        <ThemeProvider attribute="class" defaultTheme="light">
          <KernelProvider kernel={kernelWith(admin)}>
            <UserProvider initialUser={null}>
              <SettingsModal />
            </UserProvider>
          </KernelProvider>
        </ThemeProvider>,
      );
    });

    // 事故背景：关闭按钮曾用 asChild 把 onClick/type 合并进 <X/>（一个 <svg>），
    // 于是既不是 <button>（不可聚焦、无 aria-label），className 又被子元素覆盖 → 贴在左上角被圆角切掉。
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="关闭"]');
    expect(close, "关闭按钮必须是带 aria-label 的真 <button>").not.toBeNull();
    expect(close!.tagName).toBe("BUTTON");
    expect(close!.className).toContain("absolute");
    expect(close!.className).toContain("right-3.5");
    expect(close!.className).toContain("top-3.5");
    expect(close!.querySelector("svg")).not.toBeNull();

    // 「设置」只是弹窗标题（sr-only），导航里不再有那个看着像选项的 11px 小标题
    const nav = document.querySelector('nav[aria-label="设置导航"]')!;
    expect(nav.textContent).toBe("外观插件");
  });
});
