// 装配层单测：稳定 id 契约 / patch 语义 / 单条失败不掀桌 / 卸载顺序。
import { describe, it, expect, vi } from "vitest";
import { Context, FiberState } from "@/lib/kernel";
import {
  applyPatches,
  assertStableIds,
  formatLoadReport,
  loadPlugins,
  type PluginEntry,
} from "@/lib/kernel/loader";

/** 造一个插件：记录 apply 收到的 config，并可提供/清理一个服务 */
function probe(name: string, calls: string[] = []) {
  return {
    calls,
    plugin: {
      name,
      apply: (ctx: Context, config?: unknown) => {
        calls.push(`${name}:apply:${JSON.stringify(config ?? null)}`);
        ctx.provide(`svc:${name}`, name);
        ctx.effect(() => {
          calls.push(`${name}:dispose`);
        });
      },
    },
  };
}

const entry = (id: string, plugin: unknown, rest: Partial<PluginEntry> = {}): PluginEntry => ({
  id,
  plugin: plugin as PluginEntry["plugin"],
  ...rest,
});

describe("lib/kernel/loader 稳定 id 契约", () => {
  it("缺 id 或 id 为空 → 就地抛错（防'随机 id 导致改配置即重挂'）", () => {
    expect(() => assertStableIds([entry("", probe("a").plugin)])).toThrow(/缺少 id/);
    expect(() =>
      assertStableIds([{ plugin: probe("a").plugin } as unknown as PluginEntry]),
    ).toThrow(/缺少 id/);
  });

  it("id 重复 → 抛错（id 用于 patch 定位与卸载，必须唯一）", () => {
    expect(() =>
      assertStableIds([entry("dup", probe("a").plugin), entry("dup", probe("b").plugin)]),
    ).toThrow(/重复 id「dup」/);
  });

  it("loadPlugins 同样强制 id 契约", () => {
    const ctx = Context.createRoot();
    expect(() => loadPlugins(ctx, [entry("", probe("a").plugin)])).toThrow(/缺少 id/);
  });
});

describe("lib/kernel/loader 装配与报告", () => {
  it("按清单顺序挂载，报告含 id/name/state，服务立即可用", () => {
    const ctx = Context.createRoot();
    const a = probe("alpha");
    const b = probe("beta");

    const report = loadPlugins(ctx, [entry("alpha", a.plugin), entry("beta", b.plugin, { config: { x: 1 } })]);

    expect(report.mounted.map((m) => m.id)).toEqual(["alpha", "beta"]);
    expect(report.mounted.every((m) => m.state === FiberState.ACTIVE)).toBe(true);
    expect(ctx.get("svc:alpha")).toBe("alpha");
    expect(a.calls).toContain('alpha:apply:null');
    expect(b.calls).toContain('beta:apply:{"x":1}');
    expect(formatLoadReport(report)).toContain("已装配 2 个插件");
  });

  it("disabled 条目被跳过（保留在清单里，便于 patch 再启用）", () => {
    const ctx = Context.createRoot();
    const report = loadPlugins(ctx, [
      entry("on", probe("on").plugin),
      entry("off", probe("off").plugin, { disabled: true }),
    ]);

    expect(report.mounted.map((m) => m.id)).toEqual(["on"]);
    expect(report.skipped).toEqual(["off"]);
    expect(ctx.get("svc:off")).toBeUndefined();
    expect(formatLoadReport(report)).toContain("已禁用：off");
  });

  it("单条挂载失败不掀桌：记入 failed，后续条目照常装配", () => {
    const ctx = Context.createRoot();
    const boom = {
      name: "boom",
      apply: () => {
        throw new Error("配置非法");
      },
    };
    const report = loadPlugins(ctx, [
      entry("boom", boom),
      entry("after", probe("after").plugin),
    ]);

    expect(report.mounted.map((m) => m.id)).toEqual(["after"]);
    expect(report.failed).toEqual([{ id: "boom", error: "配置非法" }]);
    expect(formatLoadReport(report)).toContain("✗ 1 个插件挂载失败");
    expect(ctx.get("svc:after")).toBe("after");
  });

  it("dispose() 逆序卸载全部条目，服务与副作用一并回收", async () => {
    const ctx = Context.createRoot();
    const calls: string[] = [];
    const report = loadPlugins(ctx, [
      entry("first", probe("first", calls).plugin),
      entry("second", probe("second", calls).plugin),
    ]);

    await report.dispose();

    expect(calls.filter((c) => c.endsWith(":dispose"))).toEqual(["second:dispose", "first:dispose"]);
    expect(ctx.get("svc:first")).toBeUndefined();
    expect(ctx.get("svc:second")).toBeUndefined();
    expect(report.mounted).toEqual([]);
  });
});

describe("lib/kernel/loader patch 语义", () => {
  const base: PluginEntry[] = [
    entry("a", probe("a").plugin, { config: { from: "composition" } }),
    entry("b", probe("b").plugin, { disabled: true }),
  ];

  it("按 id 定位并**整块替换** config（不深合并）", () => {
    const { entries } = applyPatches(base, [{ id: "a", config: { replaced: true } }]);

    expect(entries[0].config).toEqual({ replaced: true });
    expect(entries[1].config).toBeUndefined();
    // 入参不被修改
    expect(base[0].config).toEqual({ from: "composition" });
  });

  it("patch 可禁用/重新启用条目", () => {
    const { entries } = applyPatches(base, [
      { id: "a", disabled: true },
      { id: "b", disabled: false },
    ]);

    expect(entries[0].disabled).toBe(true);
    expect(entries[1].disabled).toBe(false);
  });

  it("带 insert 的 patch 追加新条目（可被后续 patch 继续定位）", () => {
    const { entries } = applyPatches(base, [
      { id: "c", plugin: probe("c").plugin, insert: true, config: { v: 1 } },
      { id: "c", config: { v: 2 } },
    ]);

    expect(entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(entries[2].config).toEqual({ v: 2 });
  });

  it("未知 id 只警告不致命（patch 常跨版本复用）", () => {
    const warn = vi.fn();
    const { entries, unknownPatchIds } = applyPatches(base, [{ id: "ghost", config: {} }], {
      onWarn: warn,
    });

    expect(unknownPatchIds).toEqual(["ghost"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ghost"));
    expect(entries).toHaveLength(2);
  });

  it("patch 结果可直接交给 loadPlugins（端到端）", () => {
    const ctx = Context.createRoot();
    const calls: string[] = [];
    const { entries } = applyPatches([entry("cfg", probe("cfg", calls).plugin)], [
      { id: "cfg", config: { model: "patched" } },
    ]);

    const report = loadPlugins(ctx, entries);

    expect(report.mounted.map((m) => m.id)).toEqual(["cfg"]);
    expect(calls).toContain('cfg:apply:{"model":"patched"}');
  });
});
