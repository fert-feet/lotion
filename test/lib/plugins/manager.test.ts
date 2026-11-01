// 插件管理器单测：静态清单合并、核心保护、配置写入、动态插件委托。
import { describe, expect, it } from "vitest";
import { createRootContext } from "@/lib/kernel";
import type { DynamicRecord, DynamicRunner } from "@/lib/seams/dynamic";
import { createPluginManager, PluginAdminError } from "@/lib/local/plugin-manager";
import { createMemoryPluginsSettings } from "../../mocks/plugin-settings";

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

function createManager(options: { dynamic?: DynamicRunner } = {}) {
  const settings = createMemoryPluginsSettings();
  const manager = createPluginManager({
    ctx: createRootContext(),
    settings,
    ...(options.dynamic ? { getDynamic: () => options.dynamic } : {}),
  });
  return { manager, settings };
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
