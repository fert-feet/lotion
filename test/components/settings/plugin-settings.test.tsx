// @vitest-environment jsdom
// 插件设置页：列表渲染、核心插件保护、启停提示、配置弹窗保存。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRootContext } from "@/lib/kernel";
import { providePluginAdmin, type PluginAdminService, type PluginInfo } from "@/lib/seams/plugins";
import { createUiSlots, provideUiSlots } from "@/lib/seams/ui-slots";
import { PluginSettings } from "@/components/settings/plugin-settings";
import { KernelProvider } from "@/src/kernel/react";
import type { ClientKernel } from "@/src/kernel/client";

let container: HTMLDivElement;
let root: Root;

function plugin(overrides: Partial<PluginInfo> & Pick<PluginInfo, "id" | "title">): PluginInfo {
  return {
    description: "测试插件",
    scope: "host",
    source: "builtin",
    version: "0.1.0",
    enabled: true,
    approved: true,
    core: false,
    restartRequired: true,
    status: "active",
    config: {},
    configFields: [],
    capabilities: ["httpRoutes"],
    ...overrides,
  };
}

const corePlugin = plugin({ id: "tools-registry", title: "AI 工具注册表", core: true });
const aiPanel = plugin({
  id: "ui-ai-panel",
  title: "AI 助手面板",
  scope: "ui",
  status: "active",
});
const routeAuth = plugin({
  id: "route-auth",
  title: "认证路由",
  configFields: [{ key: "label", label: "标签", type: "string", default: "登录" }],
});

function makeKernel(admin: PluginAdminService): ClientKernel {
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

function makeAdmin(initial: PluginInfo[]) {
  let items = [...initial];
  const admin = {
    list: vi.fn(async () => items),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      items = items.map((item) => (item.id === id ? { ...item, enabled } : item));
      return items.find((item) => item.id === id)!;
    }),
    setConfig: vi.fn(async (id: string, config: Record<string, unknown>) => {
      items = items.map((item) => (item.id === id ? { ...item, config } : item));
      return items.find((item) => item.id === id)!;
    }),
    approve: vi.fn(async () => corePlugin),
    run: vi.fn(async () => corePlugin),
    stop: vi.fn(async () => corePlugin),
    remove: vi.fn(async () => undefined),
    source: vi.fn(async () => ({})),
    market: vi.fn(async () => []),
    install: vi.fn(async () => corePlugin),
    clientConfig: vi.fn(async () => ({ disabledUi: [] })),
  } satisfies PluginAdminService;
  return admin;
}

async function mount(admin: PluginAdminService) {
  await act(async () => {
    root.render(
      <KernelProvider kernel={makeKernel(admin)}>
        <PluginSettings />
      </KernelProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll("[role=dialog]").forEach((node) => node.remove());
});

describe("PluginSettings", () => {
  it("渲染插件列表，核心插件开关禁用", async () => {
    const admin = makeAdmin([corePlugin, aiPanel, routeAuth]);
    await mount(admin);

    expect(container.textContent).toContain("AI 工具注册表");
    expect(container.textContent).toContain("AI 助手面板");
    const coreSwitch = container.querySelector<HTMLButtonElement>(
      '[aria-label="AI 工具注册表 启用状态"]',
    );
    expect(coreSwitch?.disabled).toBe(true);
  });

  it("切换 UI 插件后调用 setEnabled 并提示刷新", async () => {
    const admin = makeAdmin([corePlugin, aiPanel, routeAuth]);
    await mount(admin);

    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="AI 助手面板 启用状态"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      toggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(admin.setEnabled).toHaveBeenCalledWith("ui-ai-panel", false);
    expect(container.textContent).toContain("刷新页面后生效");
  });

  it("配置弹窗按字段生成表单并保存对象", async () => {
    const admin = makeAdmin([routeAuth]);
    await mount(admin);

    const configButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "配置",
    );
    await act(async () => {
      configButton?.click();
    });

    const input = document.querySelector<HTMLInputElement>("#plugin-config-label");
    expect(input?.value).toBe("登录");

    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "保存",
    );
    await act(async () => {
      save?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(admin.setConfig).toHaveBeenCalledWith("route-auth", { label: "登录" });
  });
});
