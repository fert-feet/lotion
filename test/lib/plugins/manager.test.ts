// 插件管理器单测：静态清单合并、核心保护、配置写入、动态插件委托。
import { describe, expect, it } from "vitest";
import { createRootContext } from "@/lib/kernel";
import type { DynamicRecord, DynamicRunner } from "@/lib/seams/dynamic";
import type { MarketEntry } from "@/lib/seams/plugins";
import type { SettingsSection } from "@/lib/seams/settings";
import type { MarketSettings } from "@/lib/local/lotion-config";
import type { InstalledPluginManifest, PluginPackageStore } from "@/lib/local/plugin-package";
import type { PluginMarket } from "@/lib/local/plugin-market";
import type { InstalledPluginRuntime } from "@/lib/local/plugin-runtime";
import { createPluginManager, PluginAdminError } from "@/lib/local/plugin-manager";
import type { StaticPluginController } from "@/lib/local/static-plugin-controller";
import {
  createMemoryMarketSettings,
  createMemoryPluginsSettings,
} from "../../mocks/plugin-settings";

function createFakeRunner() {
  const records = new Map<string, DynamicRecord>();
  const getRecord = (id: string): DynamicRecord => {
    const record = records.get(id);
    if (!record) throw new Error(`未知动态插件 ${id}`);
    return record;
  };

  const runner: DynamicRunner = {
    define() {
      throw new Error("测试未使用 define");
    },
    async run(id) {
      const record = getRecord(id);
      record.state = "running";
      return record;
    },
    async stop(id) {
      const record = getRecord(id);
      record.state = "stopped";
      return record;
    },
    async undefine(id) {
      const record = records.get(id);
      records.delete(id);
      return record;
    },
    get: (id) => records.get(id),
    list: () => [...records.values()],
    approve(id) {
      const record = getRecord(id);
      record.state = "approved";
      return record;
    },
    runningIds: () =>
      [...records.entries()].filter(([, record]) => record.state === "running").map(([id]) => id),
  };

  records.set("dyn-1", {
    definition: {
      id: "dyn-1",
      title: "日报生成器",
      description: "模型写的临时插件",
      host: "harness.define({ apply() {} })",
      client: "harness.define({ apply() {} })",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    state: "defined",
  });

  return { runner, records };
}

function createFakeController() {
  const running = new Set<string>();
  const errors = new Map<string, string>();
  const calls = {
    enable: [] as Array<{ id: string; config?: unknown }>,
    disable: [] as string[],
  };
  const controller: StaticPluginController & { calls: typeof calls } = {
    calls,
    async enable(id, config) {
      calls.enable.push({ id, config });
      running.add(id);
      return { ok: true };
    },
    async disable(id) {
      calls.disable.push(id);
      running.delete(id);
    },
    running: (id) => running.has(id),
    error: (id) => errors.get(id),
  };
  return controller;
}

function createManager(
  options: {
    dynamic?: DynamicRunner;
    controller?: StaticPluginController;
    packages?: PluginPackageStore;
    market?: PluginMarket;
    marketSettings?: SettingsSection<MarketSettings>;
    runtime?: InstalledPluginRuntime;
  } = {},
) {
  const settings = createMemoryPluginsSettings();
  const marketSettings = options.marketSettings ?? createMemoryMarketSettings();
  const manager = createPluginManager({
    ctx: createRootContext(),
    settings,
    marketSettings,
    ...(options.dynamic ? { getDynamic: () => options.dynamic } : {}),
    ...(options.controller ? { getStaticController: () => options.controller } : {}),
    ...(options.packages ? { getPackages: () => options.packages } : {}),
    ...(options.market ? { market: options.market } : {}),
    ...(options.runtime ? { getRuntime: () => options.runtime } : {}),
  });
  return { manager, settings, marketSettings };
}

function installedManifest(
  overrides: Partial<InstalledPluginManifest> = {},
): InstalledPluginManifest {
  return {
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    tags: [],
    capabilities: ["tools"],
    config: [],
    enabled: true,
    approved: true,
    configValues: { keep: true },
    host: "harness.define({ apply() {} })",
    ...overrides,
  };
}

function memoryStore(items: InstalledPluginManifest[] = []): PluginPackageStore {
  let list = [...items];
  return {
    list: () => [...list],
    get: (id) => list.find((item) => item.id === id),
    save: (next) => {
      list = [...list.filter((item) => item.id !== next.id), next];
    },
    remove: (id) => {
      list = list.filter((item) => item.id !== id);
    },
  };
}

function fakeMarket(entries: MarketEntry[], bundles: Record<string, unknown> = {}) {
  let current = entries.map((entry) => ({ ...entry }));
  const downloads: string[] = [];
  const market: PluginMarket = {
    async list() {
      return current.map((entry) => ({ ...entry }));
    },
    async bundle(entry) {
      const manifest = bundles[entry.id];
      if (!manifest) throw new Error(`没有预置 bundle：${entry.id}`);
      return { manifest, sha256: "test-sha", text: "{}" };
    },
    recordDownload(id) {
      downloads.push(id);
    },
    rate(id, rating, comment) {
      current = current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              rating,
              ratingCount: (entry.ratingCount ?? 0) + 1,
              comments: [
                ...(entry.comments ?? []),
                { rating, text: comment ?? "", createdAt: "2026-01-01T00:00:00.000Z" },
              ],
            }
          : entry,
      );
    },
    publish(manifest) {
      const entry: MarketEntry = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? "",
        bundle: `local:${manifest.id}`,
        capabilities: manifest.capabilities,
      };
      current = [...current.filter((item) => item.id !== entry.id), entry];
      return entry;
    },
    source() {
      return { url: "", remote: false, requireSignature: false };
    },
  };
  return { market, downloads, entries: () => current };
}

function fakeRuntime() {
  return {
    mount: async () => ({ ok: true }),
    unmount: async () => {},
    startAll: async () => {},
    runningIds: () => [],
    error: () => undefined,
    dispose: async () => {},
  } satisfies InstalledPluginRuntime;
}

describe("插件管理器（静态）", () => {
  it("合并目录与默认状态：动态通道默认关闭，UI 插件默认开启", async () => {
    const { manager } = createManager();
    const list = await manager.list();
    const dynamic = list.find((item) => item.id === "dynamic-plugins");
    const ui = list.find((item) => item.id === "ui-ai-panel");

    expect(dynamic).toMatchObject({ enabled: false, status: "disabled", core: false });
    expect(ui).toMatchObject({ enabled: true, status: "active", scope: "ui", restartRequired: true });
    expect(list.filter((item) => item.core).every((item) => item.enabled)).toBe(true);
  });

  it("启停写入 settings patch；核心插件拒绝禁用", async () => {
    const { manager, settings } = createManager();

    const enabled = await manager.setEnabled("dynamic-plugins", true);
    expect(enabled.enabled).toBe(true);
    expect(settings.snapshot()["dynamic-plugins"]).toEqual({ disabled: false });

    await expect(manager.setEnabled("tools-registry", false)).rejects.toMatchObject({
      code: "CORE_PLUGIN",
    });
  });

  it("配置写入按 id 合并，不影响其它 patch", async () => {
    const { manager, settings } = createManager();
    await manager.setConfig("route-auth", { note: "只读演示" });
    await manager.setEnabled("ui-ai-panel", false);

    expect(settings.snapshot()).toMatchObject({
      "route-auth": { config: { note: "只读演示" } },
      "ui-ai-panel": { disabled: true },
    });
  });

  it("client-config 只回 disabled 的 UI 插件 id", async () => {
    const { manager } = createManager();
    expect(await manager.clientConfig()).toEqual({ disabledUi: [] });
    await manager.setEnabled("ui-ai-panel", false);
    expect(await manager.clientConfig()).toEqual({ disabledUi: ["ui-ai-panel"] });
  });

  it("未知 id 抛 NOT_FOUND；内置插件不能卸载", async () => {
    const { manager } = createManager();
    await expect(manager.setEnabled("ghost", true)).rejects.toBeInstanceOf(PluginAdminError);
    await expect(manager.remove("route-auth")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("有热挂载控制器时启停立即生效，宿主插件不再要求重启", async () => {
    const controller = createFakeController();
    const { manager } = createManager({ controller });

    const enabled = await manager.setEnabled("dynamic-plugins", true);
    expect(controller.calls.enable).toEqual([{ id: "dynamic-plugins", config: undefined }]);
    expect(enabled).toMatchObject({ enabled: true, status: "active", restartRequired: false });

    const ui = (await manager.list()).find((item) => item.id === "ui-ai-panel");
    expect(ui?.restartRequired).toBe(true); // UI 插件仍要刷新页面
  });

  it("改静态插件配置会热重挂并传入新 config", async () => {
    const controller = createFakeController();
    const { manager } = createManager({ controller });

    const info = await manager.setConfig("route-auth", { label: "登录" });
    expect(controller.calls.disable).toContain("route-auth");
    expect(controller.calls.enable).toContainEqual({ id: "route-auth", config: { label: "登录" } });
    expect(info.config).toEqual({ label: "登录" });
  });

  it("核心插件配置不允许从插件页改", async () => {
    const { manager } = createManager();
    await expect(manager.setConfig("tools-registry", { x: 1 })).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });
});

describe("插件管理器（动态插件委托）", () => {
  it("列表合并动态定义，审批/运行/停止状态正确", async () => {
    const { runner } = createFakeRunner();
    const { manager } = createManager({ dynamic: runner });

    const before = (await manager.list()).find((item) => item.id === "dyn-1");
    expect(before).toMatchObject({ source: "dynamic", enabled: false, approved: false, restartRequired: false });

    const approved = await manager.approve("dyn-1");
    expect(approved.approved).toBe(true);

    const running = await manager.setEnabled("dyn-1", true);
    expect(running).toMatchObject({ enabled: true, status: "active" });

    const stopped = await manager.stop("dyn-1");
    expect(stopped.enabled).toBe(false);
  });

  it("源码预览与删除委托给 runner", async () => {
    const { runner, records } = createFakeRunner();
    const { manager } = createManager({ dynamic: runner });

    expect(await manager.source("dyn-1")).toEqual({
      host: "harness.define({ apply() {} })",
      client: "harness.define({ apply() {} })",
    });

    await manager.remove("dyn-1");
    expect(records.has("dyn-1")).toBe(false);
    expect((await manager.list()).some((item) => item.id === "dyn-1")).toBe(false);
  });

  it("没有 runner 时动态操作抛 UNSUPPORTED（提示先启用通道）", async () => {
    const { manager } = createManager();
    await expect(manager.approve("dyn-1")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});

describe("插件管理器（市场与更新）", () => {
  it("已安装插件从市场标记可更新版本", async () => {
    const packages = memoryStore([installedManifest({ version: "1.0.0" })]);
    const { market } = fakeMarket([
      { id: "demo", name: "Demo", version: "1.1.0", description: "", bundle: "/demo.json" },
    ]);
    const { manager } = createManager({ packages, market });

    const info = (await manager.list()).find((item) => item.id === "demo");
    expect(info).toMatchObject({ version: "1.0.0", latestVersion: "1.1.0", updateAvailable: true });
  });

  it("update 保留启用态/配置，但客户端半边必须重新审批", async () => {
    const packages = memoryStore([
      installedManifest({ enabled: true, approved: true, host: "old-host", client: "old-client" }),
    ]);
    const { market, downloads } = fakeMarket(
      [{ id: "demo", name: "Demo", version: "1.1.0", description: "", bundle: "/demo.json" }],
      {
        demo: installedManifest({
          version: "1.1.0",
          host: "new-host",
          client: "new-client",
          enabled: false,
        }),
      },
    );
    const { manager } = createManager({ packages, market, runtime: fakeRuntime() });

    const info = await manager.install("demo");
    expect(info).toMatchObject({ version: "1.1.0", enabled: true, approved: false });
    expect(packages.get("demo")).toMatchObject({
      version: "1.1.0",
      host: "new-host",
      enabled: true,
      approved: false,
      configValues: { keep: true },
    });
    expect(downloads).toEqual(["demo"]);
  });

  it("同版本/更旧版本拒绝安装", async () => {
    const packages = memoryStore([installedManifest({ version: "1.1.0" })]);
    const { market } = fakeMarket([
      { id: "demo", name: "Demo", version: "1.1.0", description: "", bundle: "/demo.json" },
    ]);
    const { manager } = createManager({ packages, market });
    await expect(manager.install("demo")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("上传包安装为停用；导出/发布/评分往返", async () => {
    const packages = memoryStore();
    const { market } = fakeMarket([
      { id: "demo", name: "Demo", version: "1.0.0", description: "", bundle: "/demo.json" },
    ]);
    const { manager } = createManager({ packages, market });

    const uploaded = await manager.installBundle(installedManifest({ version: "2.0.0" }));
    expect(uploaded).toMatchObject({ enabled: false, version: "2.0.0" });

    const exported = await manager.exportPlugin("demo");
    expect(exported.filename).toBe("demo-2.0.0.json");

    const published = await manager.publishPlugin("demo");
    expect(published).toMatchObject({ id: "demo", bundle: "local:demo" });

    const rated = await manager.ratePlugin("demo", 4, "不错");
    expect(rated).toMatchObject({ rating: 4, ratingCount: 1 });
  });

  it("市场源：合法 URL 写入配置，非法协议拒绝", async () => {
    const { market } = fakeMarket([]);
    const { manager, marketSettings } = createManager({ market });

    await manager.setMarketSource("https://market.example/registry.json");
    expect(marketSettings.get().registryUrl).toBe("https://market.example/registry.json");

    await expect(manager.setMarketSource("ftp://example.com/x")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
