// @vitest-environment jsdom
// 市场页：目录渲染、安装调用、已安装态。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRootContext } from "@/lib/kernel";
import { providePluginAdmin } from "@/lib/seams/plugins";
import { createUiSlots, provideUiSlots } from "@/lib/seams/ui-slots";
import { PluginMarket } from "@/components/settings/plugin-market";
import { KernelProvider } from "@/src/kernel/react";
import type { ClientKernel } from "@/src/kernel/client";
import type { PluginInfo } from "@/lib/seams/plugins";
import { createPluginAdminStub } from "../../mocks/plugin-admin";

let container: HTMLDivElement;
let root: Root;

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

async function mount(admin: ReturnType<typeof createPluginAdminStub>) {
  await act(async () => {
    root.render(
      <KernelProvider kernel={kernelWith(admin)}>
        <PluginMarket />
      </KernelProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const entry = {
  id: "word-count",
  name: "字数统计",
  version: "1.0.0",
  description: "示例插件",
  author: "lotion",
  bundle: "/plugin-market/word-count.json",
};

const installedInfo: PluginInfo = {
  id: "word-count",
  title: "字数统计",
  description: "示例插件",
  scope: "host",
  source: "installed",
  version: "1.0.0",
  enabled: false,
  approved: true,
  core: false,
  restartRequired: false,
  status: "disabled",
  config: {},
  configFields: [],
  capabilities: ["tools"],
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("PluginMarket", () => {
  it("渲染市场条目并调用 install", async () => {
    const install = vi.fn(async () => installedInfo);
    const admin = createPluginAdminStub({
      market: vi.fn(async () => [entry]),
      install,
    });
    await mount(admin);

    expect(container.textContent).toContain("字数统计");
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "安装");
    await act(async () => {
      button?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(install).toHaveBeenCalledWith("word-count");
    expect(container.textContent).toContain("已安装");
  });

  it("已安装的条目不重复安装", async () => {
    const admin = createPluginAdminStub({
      market: vi.fn(async () => [entry]),
      list: vi.fn(async () => [installedInfo]),
    });
    await mount(admin);

    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "已安装",
    );
    expect(button?.disabled).toBe(true);
  });

  it("市场为空时显示空态", async () => {
    await mount(createPluginAdminStub());
    expect(container.textContent).toContain("市场里还没有插件");
  });
});
