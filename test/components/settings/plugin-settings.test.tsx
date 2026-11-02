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
const dynamicPlugin = plugin({
  id: "dyn-1",
  title: "日报生成器",
  description: "AI 在运行时定义的临时插件",
  source: "dynamic",
  scope: "ui",
  enabled: false,
  approved: false,
  status: "stopped",
  restartRequired: false,
  capabilities: ["tools", "uiSlots"],
});

function findButton(label: string, scope: ParentNode = document): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll("button")].find((button) => button.textContent === label);
}

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
  const find = (id: string) => items.find((item) => item.id === id)!;
  const admin = {
    list: vi.fn(async () => items),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      items = items.map((item) =>
        item.id === id ? { ...item, enabled, status: enabled ? "active" : "stopped" } : item,
      );
      return find(id);
    }),
    setConfig: vi.fn(async (id: string, config: Record<string, unknown>) => {
      items = items.map((item) => (item.id === id ? { ...item, config } : item));
      return find(id);
    }),
    approve: vi.fn(async (id: string) => {
      items = items.map((item) => (item.id === id ? { ...item, approved: true } : item));
      return find(id);
    }),
    run: vi.fn(async (id: string) => {
      items = items.map((item) => (item.id === id ? { ...item, enabled: true } : item));
      return find(id);
    }),
    stop: vi.fn(async (id: string) => {
      items = items.map((item) => (item.id === id ? { ...item, enabled: false } : item));
      return find(id);
    }),
    remove: vi.fn(async (id: string) => {
      items = items.filter((item) => item.id !== id);
    }),
    source: vi.fn(async () => ({
      host: "harness.define({ name: 'demo-host', apply() {} })",
      client: "harness.define({ name: 'demo-client', apply() {} })",
    })),
    market: vi.fn(async () => []),
    install: vi.fn(async (id: string) => find(id)),
    installBundle: vi.fn(async () => corePlugin),
    exportPlugin: vi.fn(async () => ({ filename: "demo.json", bundle: {} })),
    publishPlugin: vi.fn(async () => ({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      description: "",
      bundle: "local:demo",
    })),
    ratePlugin: vi.fn(async () => ({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      description: "",
      bundle: "local:demo",
    })),
    getMarketSource: vi.fn(async () => ({ url: "", remote: false, requireSignature: false })),
    setMarketSource: vi.fn(async (url: string) => ({
      url,
      remote: url.length > 0,
      requireSignature: false,
    })),
    clientConfig: vi.fn(async () => ({ disabledUi: [] })),
    clientHalves: vi.fn(async () => []),
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

  it("动态插件：批准客户端半边并提示刷新", async () => {
    const admin = makeAdmin([dynamicPlugin]);
    await mount(admin);

    expect(container.textContent).toContain("AI 生成");
    const approve = findButton("批准客户端半边", container);
    await act(async () => {
      approve?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(admin.approve).toHaveBeenCalledWith("dyn-1");
    expect(container.textContent).toContain("已批准");
  });

  it("动态插件：源码预览展示 host / client 两半", async () => {
    const admin = makeAdmin([dynamicPlugin]);
    await mount(admin);

    await act(async () => {
      findButton("查看代码", container)?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(admin.source).toHaveBeenCalledWith("dyn-1");
    expect(document.body.textContent).toContain("demo-host");
    expect(document.body.textContent).toContain("demo-client");
  });

  it("动态插件：删除需二次确认，确认后从列表移除", async () => {
    const admin = makeAdmin([dynamicPlugin]);
    await mount(admin);

    // 第一次点击打开确认框
    await act(async () => {
      findButton("删除", container)?.click();
    });
    expect(document.body.textContent).toContain("删除动态插件？");

    // 确认框里的「删除」是最后一个同名按钮
    const deletes = [...document.querySelectorAll("button")].filter(
      (button) => button.textContent === "删除",
    );
    await act(async () => {
      deletes.at(-1)?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(admin.remove).toHaveBeenCalledWith("dyn-1");
    expect(container.querySelector('[aria-label="日报生成器 启用状态"]')).toBeNull();
  });
});

describe("PluginSettings 已安装插件", () => {
  it("显示可更新徽标，发布调用 publishPlugin", async () => {
    const installed = plugin({
      id: "demo",
      title: "第三方插件",
      source: "installed",
      latestVersion: "1.1.0",
      updateAvailable: true,
    });
    const admin = makeAdmin([installed]);
    await mount(admin);

    expect(container.textContent).toContain("可更新 v1.1.0");
    await act(async () => {
      findButton("发布到本地市场", container)?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(admin.publishPlugin).toHaveBeenCalledWith("demo");
    expect(container.textContent).toContain("已发布到本地市场");
  });
});
