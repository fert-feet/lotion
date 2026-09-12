// Cordis 适配层单测：settle/audit/loader 在**真实 Cordis** 上的行为。
// 这些用例是"自研内核 → 真实 Cordis"迁移的验收网。
import { describe, it, expect, vi } from "vitest";
import { Service, type Context } from "@deepseek-ai/cordis";
import {
  FIBER_STATE_NAMES,
  FiberState,
  audit,
  auditOk,
  createRootContext,
  formatAudit,
  settle,
  settleAll,
} from "@/lib/kernel/cordis";
import {
  applyPatches,
  assertStableIds,
  formatLoadReport,
  loadPlugins,
  type PluginEntry,
} from "@/lib/kernel/cordis-loader";

const entry = (id: string, plugin: unknown, rest: Partial<PluginEntry> = {}): PluginEntry => ({
  id,
  plugin,
  ...rest,
});

describe("lib/kernel/cordis 适配层", () => {
  it("createRootContext：根上下文可建、根 fiber ACTIVE", () => {
    const ctx = createRootContext();

    expect(ctx.fiber.state).toBe(FiberState.ACTIVE);
    expect(FIBER_STATE_NAMES[FiberState.PENDING]).toBe("pending");
  });

  it("settle / settleAll：等异步激活完成（Cordis 的核心差异）", async () => {
    const ctx = createRootContext();
    const applied: string[] = [];
    const fiber = ctx.plugin({ name: "a", apply: () => void applied.push("a") });

    await settle(fiber);
    expect(applied).toEqual(["a"]);
    expect(fiber.state).toBe(FiberState.ACTIVE);

    ctx.plugin({ name: "b", apply: () => void applied.push("b") });
    await settleAll(ctx);
    expect(applied.sort()).toEqual(["a", "b"]);
  });

  it("audit：缺依赖的插件被列为 PENDING 并报出缺失服务（Cordis 没有内置审计）", async () => {
    const ctx = createRootContext();
    ctx.plugin({ name: "needs-svc", inject: ["svc"], apply: () => {} });
    await settleAll(ctx);

    const report = audit(ctx);

    expect(report.pending).toEqual([{ name: "needs-svc", missing: ["svc"] }]);
    expect(auditOk(report)).toBe(false);
    expect(formatAudit(report)).toContain("等待 svc");

    ctx.provide("svc", 1);
    await settleAll(ctx);

    expect(audit(ctx).pending).toEqual([]);
    expect(auditOk(audit(ctx))).toBe(true);
  });

  it("audit：服务清单来自 reflect 层（Symbol 键），激活失败被列为 FAILED", async () => {
    const ctx = createRootContext();
    ctx.provide("a", 1);
    ctx.provide("b", 2);
    ctx.plugin({
      name: "boom",
      apply: () => {
        throw new Error("配置非法");
      },
    });
    await settleAll(ctx);

    const report = audit(ctx);

    expect(report.services.sort()).toEqual(["a", "b"]);
    expect(report.failed).toEqual([{ name: "boom", error: "配置非法" }]);
  });

  it("Service 子类作为插件：super(ctx, name) 注册、卸载即注销", async () => {
    // Service 子类本身就是合法插件形态（Cordis 的类插件）：new Demo(ctx) 时即注册服务
    class Demo extends Service {
      constructor(ctx: Context) {
        super(ctx, "demo");
      }
      hello() {
        return "hi";
      }
    }

    const ctx = createRootContext();
    const report = await loadPlugins(ctx, [entry("demo-provider", Demo)]);

    expect(report.failed).toEqual([]);
    expect(report.mounted.map((m) => m.id)).toEqual(["demo-provider"]);
    expect((ctx.get("demo") as Demo | undefined)?.hello()).toBe("hi");

    await report.dispose();
    expect(ctx.get("demo")).toBeUndefined();
  });
});

describe("lib/kernel/cordis-loader 装配语义", () => {
  it("按清单装配并 settle；报告含 id/name/状态；服务立即可用", async () => {
    const ctx = createRootContext();
    const calls: string[] = [];

    const report = await loadPlugins(ctx, [
      entry("a", {
        name: "alpha",
        apply: (c: { provide: (k: string, v: unknown) => void }) => {
          calls.push("a");
          c.provide("svc:a", "A");
        },
      }),
      entry("b", { name: "beta", inject: [], apply: () => void calls.push("b") }, { config: { x: 1 } }),
    ]);

    expect(report.mounted.map((m) => ({ id: m.id, state: m.stateName }))).toEqual([
      { id: "a", state: "active" },
      { id: "b", state: "active" },
    ]);
    expect(calls).toEqual(["a", "b"]);
    expect(ctx.get("svc:a")).toBe("A");
    expect(formatLoadReport(report, ctx)).toContain("已装配 2 个插件");
  });

  it("disabled 条目跳过；单条失败只记入 failed 且不掀桌", async () => {
    const ctx = createRootContext();
    const report = await loadPlugins(ctx, [
      entry("off", { name: "off", apply: () => {} }, { disabled: true }),
      entry("boom", {
        name: "boom",
        apply: () => {
          throw new Error("炸了");
        },
      }),
      entry("after", { name: "after", apply: () => {} }),
    ]);

    expect(report.skipped).toEqual(["off"]);
    expect(report.failed).toEqual([{ id: "boom", error: "炸了" }]);
    // 语义：mounted 只列**成功激活**的；失败的只出现在 failed 里
    expect(report.mounted.map((m) => m.id)).toEqual(["after"]);
    expect(formatLoadReport(report)).toContain("✗ 1 个插件挂载失败");
  });

  it("缺 id / 重复 id 就地抛错", async () => {
    const ctx = createRootContext();

    expect(() => assertStableIds([{ id: "", plugin: {} }])).toThrow(/缺少 id/);
    expect(() =>
      assertStableIds([
        { id: "dup", plugin: {} },
        { id: "dup", plugin: {} },
      ]),
    ).toThrow(/重复 id/);
    await expect(loadPlugins(ctx, [{ id: "", plugin: {} }])).rejects.toThrow(/缺少 id/);
  });

  it("dispose：逆序卸载，服务随 fiber 回收", async () => {
    const ctx = createRootContext();
    const order: string[] = [];
    const report = await loadPlugins(ctx, [
      entry("first", {
        name: "first",
        apply: (c: { effect: (fn: () => () => void) => void; provide: (k: string, v: unknown) => void }) => {
          c.provide("svc:first", 1);
          c.effect(() => () => {
            order.push("first");
          });
        },
      }),
      entry("second", {
        name: "second",
        apply: (c: { effect: (fn: () => () => void) => void }) => {
          c.effect(() => () => {
            order.push("second");
          });
        },
      }),
    ]);

    await report.dispose();

    expect(order).toEqual(["second", "first"]);
    expect(ctx.get("svc:first")).toBeUndefined();
    expect(report.mounted).toEqual([]);
  });

  it("patch：整块替换 config、可禁用/启用、insert 新条目、未知 id 只警告", async () => {
    const base: PluginEntry[] = [
      entry("a", { name: "a" }, { config: { from: "composition" } }),
      entry("b", { name: "b" }, { disabled: true }),
    ];

    const replaced = applyPatches(base, [{ id: "a", config: { replaced: true } }]);
    expect(replaced.entries[0].config).toEqual({ replaced: true });
    expect(base[0].config).toEqual({ from: "composition" }); // 入参不被改

    const toggled = applyPatches(base, [
      { id: "a", disabled: true },
      { id: "b", disabled: false },
    ]);
    expect([toggled.entries[0].disabled, toggled.entries[1].disabled]).toEqual([true, false]);

    const inserted = applyPatches(base, [
      { id: "c", plugin: { name: "c" }, insert: true, config: { v: 1 } },
      { id: "c", config: { v: 2 } },
    ]);
    expect(inserted.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(inserted.entries[2].config).toEqual({ v: 2 });

    const warn = vi.fn();
    const unknown = applyPatches(base, [{ id: "ghost", config: {} }], { onWarn: warn });
    expect(unknown.unknownPatchIds).toEqual(["ghost"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ghost"));
  });
});
