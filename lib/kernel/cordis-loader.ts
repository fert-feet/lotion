// 装配层（Cordis 版）：把"组合清单"装到真实 Cordis 上下文上。
//
// 与自研版的三点差异：
//   1. `loadPlugins` 是 **async**：Cordis 的激活是异步的（必须 settle 完才算装好）
//   2. 失败不抛异常而是落在 fiber 状态上：Cordis 捕获 apply 抛错并把 fiber 置 FAILED，
//      因此报告里的 failed 来自"挂载后审计"而不是 try/catch
//   3. 卸载走 Cordis 的 fiber.dispose()（已内置等待静默）
//
// 三条不变量（与自研版一致，来自 DSH 的踩坑）：
//   * id 必填且唯一（省略 id → 每次都当新插件重挂、丢光 effect 状态）
//   * patch 按 id 定位、**整块替换 config**（不深合并）；未知 id 只警告
//   * 单条失败不影响其它条目
import type { Context, Fiber } from "@deepseek-ai/cordis";
import { audit, FiberState, FIBER_STATE_NAMES, settle } from "./cordis";

/** 组合清单里的一行 */
export interface PluginEntry {
  /** **稳定唯一 id**：patch 定位、审计与卸载都靠它（必填） */
  id: string;
  /** 插件本体（函数 / 带 apply 的对象 / Service 子类） */
  plugin: unknown;
  /** 传给 apply 的配置 */
  config?: unknown;
  /** 禁用该条目（保留在清单里，便于用 patch 重新启用） */
  disabled?: boolean;
}

/** patch：按 id 覆盖某条目的 config/disabled，或插入新条目 */
export type PluginPatch =
  | { id: string; config?: unknown; disabled?: boolean }
  | { id: string; plugin: unknown; insert: true; config?: unknown; disabled?: boolean };

export interface MountedEntry {
  id: string;
  name: string;
  state: number;
  stateName: string;
}

export interface LoadReport {
  /** **成功激活**的条目（失败的只出现在 failed 里） */
  mounted: MountedEntry[];
  /** 被 disabled 跳过的 id */
  skipped: string[];
  /** 挂载后仍 FAILED 的 id 与原因 */
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
      config: "config" in patch ? patch.config : target.config,
      disabled: "disabled" in patch ? patch.disabled : target.disabled,
    };
  }

  return { entries: result, unknownPatchIds };
}

/** id 契约：非空且唯一（省略 id 的坑见文件头注释） */
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

/**
 * 按清单装配插件（**异步**：Cordis 的激活需要 settle）。
 * 逐条挂载、逐条记录；单条失败不影响其它条目（失败信息来自挂载后的审计）。
 */
export async function loadPlugins(
  ctx: Context,
  entries: readonly PluginEntry[],
  options: LoadOptions = {},
): Promise<LoadReport> {
  assertStableIds(entries);

  const report: LoadReport = {
    mounted: [],
    skipped: [],
    failed: [],
    unknownPatchIds: [],
    fibers: new Map(),
    async dispose() {
      for (const id of [...report.fibers.keys()].reverse()) {
        const fiber = report.fibers.get(id);
        if (fiber) await fiber.dispose();
      }
      report.fibers.clear();
      report.mounted = [];
    },
  };
  void options;

  for (const entry of entries) {
    if (entry.disabled) {
      report.skipped.push(entry.id);
      continue;
    }
    // Cordis 的 plugin 类型很严（函数 / 带 apply 的对象 / Service 子类），清单里是 unknown → 收窄
    try {
      const fiber = ctx.plugin(
        entry.plugin as Parameters<Context["plugin"]>[0],
        entry.config,
      ) as unknown as Fiber;
      report.fibers.set(entry.id, fiber);
      await settle(fiber);
      if (fiber.state === FiberState.FAILED) {
        const error = (fiber as unknown as { _error?: unknown })._error;
        report.failed.push({
          id: entry.id,
          error: error instanceof Error ? error.message : String(error ?? "未知错误"),
        });
        continue;
      }
      report.mounted.push({
        id: entry.id,
        name: fiber.name,
        state: fiber.state,
        stateName: FIBER_STATE_NAMES[fiber.state] ?? String(fiber.state),
      });
    } catch (error) {
      // Cordis 在部分路径上会把加载期异常**同步抛出**（而不是只把 fiber 置 FAILED）；
      // 对齐"单条失败不掀桌"的契约：两种表现都收敛成报告里的一条 failed。
      report.failed.push({
        id: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}

/** 报告的可读文本（启动日志用） */
export function formatLoadReport(report: LoadReport, ctx?: Context): string {
  const lines = [`[loader] 已装配 ${report.mounted.length} 个插件`];
  if (report.skipped.length > 0) lines.push(`[loader] 已禁用：${report.skipped.join("、")}`);
  if (report.failed.length > 0) {
    lines.push(`[loader] ✗ ${report.failed.length} 个插件挂载失败：`);
    for (const item of report.failed) lines.push(`    - ${item.id}：${item.error}`);
  }
  if (report.unknownPatchIds.length > 0) {
    lines.push(`[loader] ⚠ patch 指向未知条目：${report.unknownPatchIds.join("、")}`);
  }
  if (ctx) {
    const pending = audit(ctx).pending;
    if (pending.length > 0) {
      lines.push(`[loader] ⚠ ${pending.length} 个插件处于 PENDING（缺服务）：`);
      for (const item of pending) lines.push(`    - ${item.name}：等待 ${item.missing.join("、")}`);
    }
  }
  return lines.join("\n");
}
