// 已安装插件运行时：宿主半边挂载、工具可逆注销、能力白名单、启动恢复。
import { describe, expect, it } from "vitest";
import { createRootContext } from "@/lib/kernel";
import { createToolRegistry, provideTools, requireTools } from "@/lib/seams/tools";
import type { InstalledPluginManifest, PluginPackageStore } from "@/lib/local/plugin-package";
import { createInstalledPluginRuntime } from "@/lib/local/plugin-runtime";

const TOOL_HOST_CODE = `
harness.define({
  name: "demo",
  inject: ["tools"],
  apply: (ctx) => {
    ctx.get("tools").register({
      name: "demo_tool",
      label: "Demo",
      icon: "🧪",
      description: "demo tool",
      create: () => ({}),
    });
  },
});
`;

function manifest(overrides: Partial<InstalledPluginManifest> = {}): InstalledPluginManifest {
  return {
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    tags: [],
    capabilities: ["tools"],
    config: [],
    enabled: false,
    approved: true,
    configValues: {},
    host: TOOL_HOST_CODE,
    ...overrides,
  };
}

function memoryStore(items: InstalledPluginManifest[]): PluginPackageStore {
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

function setup(items: InstalledPluginManifest[]) {
  const ctx = createRootContext();
  provideTools(ctx, createToolRegistry<unknown>());
  const store = memoryStore(items);
  const runtime = createInstalledPluginRuntime({ ctx, store });
  return { ctx, store, runtime };
}

describe("createInstalledPluginRuntime", () => {
  it("挂载宿主半边后工具出现；卸载后工具注销", async () => {
    const { ctx, runtime } = setup([manifest()]);

    expect(await runtime.mount("demo")).toEqual({ ok: true });
    expect(requireTools(ctx).names()).toContain("demo_tool");
    expect(runtime.runningIds()).toEqual(["demo"]);

    await runtime.unmount("demo");
    expect(requireTools(ctx).names()).not.toContain("demo_tool");
    expect(runtime.runningIds()).toEqual([]);
  });

  it("能力声明之外的服务注入被拒绝", async () => {
    const { runtime } = setup([
      manifest({
        host: `
harness.define({
  name: "bad",
  inject: ["httpRoutes"],
  apply: () => {},
});
`,
      }),
    ]);

    const result = await runtime.mount("demo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不在能力声明内");
    expect(runtime.error("demo")).toContain("httpRoutes");
  });

  it("startAll 只挂 enabled 的 host 半边", async () => {
    const { runtime } = setup([
      manifest({ id: "on", name: "On", enabled: true }),
      manifest({ id: "off", name: "Off", enabled: false }),
    ]);

    await runtime.startAll();
    expect(runtime.runningIds()).toEqual(["on"]);
    await runtime.dispose();
    expect(runtime.runningIds()).toEqual([]);
  });

  it("缺少 host 代码视为已在运行（纯客户端插件不占宿主 fiber）", async () => {
    const { runtime } = setup([manifest({ host: undefined, client: "harness.define({ apply(){} })" })]);
    expect(await runtime.mount("demo")).toEqual({ ok: true });
    expect(runtime.runningIds()).toEqual([]);
  });
});
