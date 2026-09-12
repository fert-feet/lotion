// 装配层：把"组合清单"（一串插件条目）装到内核上。
//
// 三条来自 DSH 的硬规则（docs/插件化架构.md §4）：
//   1. **id 必填且唯一** —— DSH 的教训：条目省略 id 时 loader 会铸一个随机 id，
//      于是每次改配置都被当成"删旧+加新"→ 重新挂载、effect 状态全丢。
//      这里直接强制显式 id，缺 id 就地抛错。
//   2. **patch 按 id 定位、整块替换 config**（不做深合并）；未知 id 只警告不致命
//      （vendor/include/src/index.ts:58-128 的语义），因为 patch 常常是跨版本复用的。
//   3. **挂载失败不掀桌**：单个条目 apply 抛错只记入报告并继续装后面的条目，
//      报告里能看到是哪个 id 失败、为什么。
import type { Context } from "./context";
import type { Plugin } from "./context";
import { FiberState } from "./fiber";
import type { Fiber } from "./fiber";

/** 组合清单里的一行 */
export interface PluginEntry {
  /** **稳定唯一 id**：patch 定位、审计与卸载都靠它（必填） */
  id: string;
  /** 插件本体（函数 / 带 apply 的对象） */
  plugin: Plugin;
  /** 传给 apply 的配置 */
  config?: unknown;
  /** 禁用该条目（保留在清单里，便于用 patch 重新启用） */
  disabled?: boolean;
}

/** patch：按 id 覆盖某条目的 config，或插入新条目 */
export type PluginPatch =
  | { id: string; config?: unknown; disabled?: boolean }
  | { id: string; plugin: Plugin; insert: true; config?: unknown; disabled?: boolean };

export interface MountedEntry {
  id: string;
  name: string;
  state: FiberState;
}

export interface LoadReport {
  mounted: MountedEntry[];
  /** 被 disabled 跳过的 id */
  skipped: string[];
  /** 挂载失败（apply 抛错）的 id 与原因 */
  failed: Array<{ id: string; error: string }>;
  /** patch 里出现但清单里没有的 id（只警告，不致命） */
  unknownPatchIds: string[];
  fibers: Map<string, Fiber>;
  /** 按挂载逆序卸载全部条目 */
  dispose: () => Promise<void>;
}

export interface LoadOptions {
  /** 未知 patch id 的告警出口（默认 console.warn） */
  onWarn?: (message: string) => void;
}

/**
 * 应用 patch 层：按 id 定位条目并**整块替换 config**（不深合并）；
 * 带 `insert: true` 的 patch 追加新条目（可被更后面的 patch 继续定位）。
 * 不修改入参（返回新数组）。
 */
export function applyPatches(
  entries: readonly PluginEntry[],
  patches: readonly PluginPatch[],
  options: LoadOptions = {},
): { entries: PluginEntry[]; unknownPatchIds: string[] } {
  const result: PluginEntry[] = entries.map((entry) => ({ ...entry }));
  const unknownPatchIds: string[] = [];
  const warn = options.onWarn ?? ((message: string) => console.warn(message));

  for (const patch of patches) {
    const index = result.findIndex((entry) => entry.id === patch.id);
    if (index < 0) {
      if ("insert" in patch && patch.insert) {
        result.push({
          id: patch.id,
          plugin: patch.plugin,
          config: patch.config,
          disabled: patch.disabled,
        });
        continue;
      }
      unknownPatchIds.push(patch.id);
      warn(`[loader] patch 指向未知条目「${patch.id}」，已跳过`);
      continue;
    }
    const target = result[index];
    result[index] = {
      ...target,
      // 整块替换：patch 给了 config 就用 patch 的，没给则保持原值
      config: "config" in patch ? patch.config : target.config,
      disabled: "disabled" in patch ? patch.disabled : target.disabled,
    };
  }

  return { entries: result, unknownPatchIds };
}

/**
 * 按清单装配插件。逐条挂载、逐条记录；**单条失败不影响其它条目**。
 * @returns 装配报告（含卸载函数）
 */
export function loadPlugins(ctx: Context, entries: readonly PluginEntry[]): LoadReport {
  assertStableIds(entries);

  const report: LoadReport = {
    mounted: [],
    skipped: [],
    failed: [],
    unknownPatchIds: [],
    fibers: new Map(),
    async dispose() {
      // 逆序卸载：后挂载的先撤（与 fiber 内部的副作用顺序一致）
      for (const id of [...report.fibers.keys()].reverse()) {
        const fiber = report.fibers.get(id);
        if (fiber) await fiber.dispose();
      }
      report.fibers.clear();
      report.mounted = [];
    },
  };

  for (const entry of entries) {
    if (entry.disabled) {
      report.skipped.push(entry.id);
      continue;
    }
    try {
      const fiber = ctx.plugin(entry.plugin, { config: entry.config, name: entry.id });
      report.fibers.set(entry.id, fiber);
      report.mounted.push({ id: entry.id, name: fiber.name, state: fiber.state });
    } catch (error) {
      report.failed.push({
        id: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}

/**
 * 校验 id 契约：非空字符串且不重复。
 * 这条校验存在的唯一理由是"省略 id 会铸随机 id"那个坑 —— 让它在装配时就炸，而不是几周后
 * 以"改个配置插件就重挂/丢状态"的形式浮现。
 */
export function assertStableIds(entries: readonly PluginEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = entry.id;
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error("[loader] 组合清单存在缺少 id 的条目：装配条目必须有稳定唯一 id");
    }
    if (seen.has(id)) {
      throw new Error(`[loader] 组合清单存在重复 id「${id}」：id 用于 patch 定位与卸载，必须唯一`);
    }
    seen.add(id);
  }
}

/** 报告的可读文本（启动日志用） */
export function formatLoadReport(report: LoadReport): string {
  const lines = [`[loader] 已装配 ${report.mounted.length} 个插件`];
  if (report.skipped.length > 0) lines.push(`[loader] 已禁用：${report.skipped.join("、")}`);
  if (report.failed.length > 0) {
    lines.push(`[loader] ✗ ${report.failed.length} 个插件挂载失败：`);
    for (const item of report.failed) lines.push(`    - ${item.id}：${item.error}`);
  }
  if (report.unknownPatchIds.length > 0) {
    lines.push(`[loader] ⚠ patch 指向未知条目：${report.unknownPatchIds.join("、")}`);
  }
  return lines.join("\n");
}
