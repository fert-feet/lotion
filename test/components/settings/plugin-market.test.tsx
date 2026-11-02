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

const updateInfo: PluginInfo = {
  ...installedInfo,
  latestVersion: "1.1.0",
  updateAvailable: true,
};

function findButton(label: string, scope: ParentNode = document): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll("button")].find((button) => button.textContent === label);
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

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
  it("安装需确认；确认后调用 install 并刷新", async () => {
    const install = vi.fn(async () => installedInfo);
    const admin = createPluginAdminStub({
      market: vi.fn(async () => [entry]),
      install,
    });
    await mount(admin);

    expect(container.textContent).toContain("字数统计");
    await act(async () => {
      findButton("安装", container)?.click();
    });
    expect(document.body.textContent).toContain("权限声明");

    await act(async () => {
      findButton("确认")?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(install).toHaveBeenCalledWith("word-count");
    expect(container.textContent).toContain("已安装/更新");
  });

  it("已安装未启用：一键启用", async () => {
    const setEnabled = vi.fn(async () => ({ ...installedInfo, enabled: true }));
    const admin = createPluginAdminStub({
      market: vi.fn(async () => [entry]),
      list: vi.fn(async () => [installedInfo]),
      setEnabled,
    });
    await mount(admin);

    await act(async () => {
      findButton("启用", container)?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(setEnabled).toHaveBeenCalledWith("word-count", true);
    expect(container.textContent).toContain("已启用");
  });

  it("客户端插件启用后可一键批准", async () => {
    const clientInstalled: PluginInfo = {
      ...installedInfo,
      id: "daily-quote",
      title: "今日一句",
      scope: "ui",
      capabilities: ["ui"],
      enabled: true,
      approved: false,
    };
    const approve = vi.fn(async () => ({ ...clientInstalled, approved: true }));
    const admin = createPluginAdminStub({
      market: vi.fn(async () => [{ ...entry, id: "daily-quote", name: "今日一句" }]),
      list: vi.fn(async () => [clientInstalled]),
      approve,
    });
    await mount(admin);

    await act(async () => {
      findButton("批准", container)?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(approve).toHaveBeenCalledWith("daily-quote");
    expect(container.textContent).toContain("已批准");
  });

  it("搜索会过滤条目", async () => {
    const other = { ...entry, id: "daily-quote", name: "今日一句", description: "随机一句" };
    const admin = createPluginAdminStub({
      market: vi.fn(async () => [entry, other]),
    });
    await mount(admin);
    expect(container.textContent).toContain("今日一句");

    const input = container.querySelector<HTMLInputElement>('[aria-label="搜索插件"]')!;
    await act(async () => {
      setInput(input, "字数");
    });

    expect(container.textContent).toContain("字数统计");
    expect(container.textContent).not.toContain("今日一句");
  });

  it("有更新时显示更新按钮，确认走 install", async () => {
    const install = vi.fn(async () => ({ ...updateInfo, version: "1.1.0" }));
    const admin = createPluginAdminStub({
      market: vi.fn(async () => [{ ...entry, version: "1.1.0" }]),
      list: vi.fn(async () => [updateInfo]),
      install,
    });
    await mount(admin);

    const update = findButton("更新 v1.1.0", container);
    expect(update?.disabled).toBe(false);
    await act(async () => {
      update?.click();
    });
    await act(async () => {
      findButton("确认")?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(install).toHaveBeenCalledWith("word-count");
  });

  it("评分弹窗提交评分与评论", async () => {
    const ratePlugin = vi.fn(async () => entry);
    const admin = createPluginAdminStub({
      market: vi.fn(async () => [entry]),
      ratePlugin,
    });
    await mount(admin);

    await act(async () => {
      findButton("评分", container)?.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="4 星"]')?.click();
    });
    await act(async () => {
      findButton("提交评分")?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(ratePlugin).toHaveBeenCalledWith("word-count", 4, undefined);
  });

  it("分类过滤与下载量排序", async () => {
    const productivity = { ...entry, category: "效率", downloads: 1 };
    const ui = {
      ...entry,
      id: "daily-quote",
      name: "今日一句",
      category: "界面",
      downloads: 99,
    };
    const admin = createPluginAdminStub({
      market: vi.fn(async () => [productivity, ui]),
    });
    await mount(admin);

    const category = container.querySelector<HTMLSelectElement>('[aria-label="分类"]')!;
    await act(async () => {
      setSelect(category, "界面");
    });
    expect(container.textContent).toContain("今日一句");
    expect(container.textContent).not.toContain("字数统计");

    await act(async () => {
      setSelect(category, "全部");
    });
    const sort = container.querySelector<HTMLSelectElement>('[aria-label="排序"]')!;
    await act(async () => {
      setSelect(sort, "downloads");
    });
    const text = container.textContent ?? "";
    expect(text.indexOf("今日一句")).toBeLessThan(text.indexOf("字数统计"));
  });

  it("可保存远端市场源", async () => {
    const setMarketSource = vi.fn(async (url: string) => ({
      url,
      remote: true,
      requireSignature: false,
    }));
    const admin = createPluginAdminStub({ setMarketSource });
    await mount(admin);

    const input = container.querySelector<HTMLInputElement>('[aria-label="市场源 URL"]')!;
    await act(async () => {
      setInput(input, "https://market.example/registry.json");
      findButton("保存", container)?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(setMarketSource).toHaveBeenCalledWith("https://market.example/registry.json");
  });

  it("市场为空时显示空态", async () => {
    await mount(createPluginAdminStub());
    expect(container.textContent).toContain("市场里还没有插件");
  });
});
