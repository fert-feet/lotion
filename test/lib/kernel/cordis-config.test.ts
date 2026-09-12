// Standard Schema Config（Cordis 的装配期校验）单测。
//
// 为什么值得有：Cordis 会在插件**启动前**按 `Config` 校验配置，非法配置直接让该 fiber FAILED、
// 且 `apply` 根本不会执行 —— 于是"配错了"在装配阶段就暴露，而不是等第一次查询。
// ⚠️ 代价：声明了 Config 的插件**必须收到配置对象**（至少 `{}`），完全不传会被判为校验失败。
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { audit, createRootContext, loadPlugins } from "@/lib/kernel";
import { mount } from "@/test/mocks/mount";
import { openTestDb } from "@/lib/local/sqlite";
import { settingsFileConfig, settingsFilePlugin } from "@/lib/local/settings-file";
import { sqliteDocStoreConfig, sqliteDocStorePlugin } from "@/lib/local/doc-store-sqlite";
import { requireDocStore } from "@/lib/seams/doc-store";
import { findSettings } from "@/lib/seams/settings";

describe("Cordis Standard Schema Config 语义", () => {
  it("合法配置：校验后传给 apply（含 schema 默认值）", async () => {
    const ctx = createRootContext();
    const seen: unknown[] = [];
    await mount(ctx, {
      name: "toy",
      Config: z.object({ n: z.number().default(7) }),
      apply: (_c: unknown, config: unknown) => void seen.push(config),
    }, {});

    expect(seen).toEqual([{ n: 7 }]);
  });

  it("非法配置：apply 不执行，且经 loader 装配时收敛成报告里的一条 failed", async () => {
    const ctx = createRootContext();
    const apply = vi.fn();
    // Cordis 对校验失败有两种表现（抛错 / 置 FAILED）——loadPlugins 把两者归一成 failed
    const report = await loadPlugins(ctx, [
      {
        id: "bad",
        plugin: { name: "bad", Config: z.object({ n: z.number() }), apply },
        config: { n: "不是数字" },
      },
    ]);

    expect(report.failed.map((item) => item.id)).toEqual(["bad"]);
    expect(report.mounted).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
  });

  it("声明了 Config 却不传配置 → 同样判为校验失败（组合清单必须传对象）", async () => {
    const ctx = createRootContext();
    const apply = vi.fn();
    const report = await loadPlugins(ctx, [
      { id: "no-config", plugin: { name: "no-config", Config: z.object({ n: z.number().default(1) }), apply } },
    ]);

    expect(report.failed.map((item) => item.id)).toEqual(["no-config"]);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("内置插件的 Config 契约", () => {
  it("settings-file：filePath 合法则挂载成功；非法（空串）则装配期失败", async () => {
    const ok = createRootContext();
    await mount(ok, settingsFilePlugin, {});
    expect(findSettings(ok)).toBeDefined();

    const bad = createRootContext();
    const report = await loadPlugins(bad, [
      { id: "settings-file", plugin: settingsFilePlugin, config: { filePath: "" } },
    ]);
    expect(report.failed.map((item) => item.id)).toEqual(["settings-file"]);
    expect(findSettings(bad)).toBeUndefined();
    expect(settingsFileConfig.safeParse({ filePath: "" }).success).toBe(false);
  });

  it("doc-store-sqlite：注入真实连接可用；注入假对象在装配期被拒", async () => {
    const ok = createRootContext();
    const db = openTestDb();
    await mount(ok, sqliteDocStorePlugin, { db });
    expect(requireDocStore(ok)).toBeDefined();

    const bad = createRootContext();
    const report = await loadPlugins(bad, [
      { id: "doc-store-sqlite", plugin: sqliteDocStorePlugin, config: { db: { 不是一个连接: true } } },
    ]);
    expect(report.failed.map((item) => item.id)).toEqual(["doc-store-sqlite"]);
    expect(audit(bad).services).not.toContain("docStore");
    expect(sqliteDocStoreConfig.safeParse({ db: { prepare: () => {} } }).success).toBe(true);
    expect(sqliteDocStoreConfig.safeParse({ db: 42 }).success).toBe(false);
  });

  it("空配置是合法的（两个内置插件的 schema 都接受 {}）", () => {
    expect(settingsFileConfig.safeParse({}).success).toBe(true);
    expect(sqliteDocStoreConfig.safeParse({}).success).toBe(true);
  });
});
