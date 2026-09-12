// 宿主组合清单（组合根的数据部分）。
//
// 分层装配（对齐 DSH docs/architecture.zh.md:19-37 的 profile/bundle/patch 思路）：
//   1. 组合层：本文件列出的条目（每行**稳定唯一 id**）
//   2. 用户层 patch：data/settings.json 的 `plugins` 命名空间，按 id 覆盖 config 或禁用条目
//   → 于是"停用某个插件 / 改某插件的配置"不需要改代码，只需改配置。
//
// 注意：**组合清单是静态层**（改动需重启）；用户 patch 走 settings，属于可热读的配置层
// （对齐 DSH 的实测结论：桌面端只有配置层热生效）。
import type Database from "better-sqlite3";
import type { PluginEntry, PluginPatch } from "@/lib/kernel";
import { provideTools } from "@/lib/seams/tools";
import { createHostToolRegistry, type HostToolRegistry } from "@/lib/ai/tools/registry";
import { registerBuiltinTools } from "@/lib/ai/tools";
import { sqliteDocStorePlugin } from "@/lib/local/doc-store-sqlite";
import { settingsFilePlugin } from "@/lib/local/settings-file";

export interface HostCompositionOptions {
  /** settings 提供方的用户层文件路径（测试注入） */
  settingsPath?: string;
  /** docStore 的 SQLite 连接（测试注入 :memory:） */
  db?: Database.Database;
}

/** 共享的工具注册表（宿主内单例；插件可往它里面加工具） */
export function createHostTools(): HostToolRegistry {
  const registry = createHostToolRegistry();
  registerBuiltinTools(registry);
  return registry;
}

/** 组合层清单：顺序即挂载顺序 */
export function hostComposition(options: HostCompositionOptions = {}): PluginEntry[] {
  return [
    {
      id: "tools-registry",
      plugin: {
        name: "tools-registry",
        apply: (ctx) => provideTools(ctx, createHostTools()),
      },
    },
    {
      id: "settings-file",
      plugin: settingsFilePlugin,
      config: options.settingsPath ? { filePath: options.settingsPath } : undefined,
    },
    {
      id: "doc-store-sqlite",
      plugin: sqliteDocStorePlugin,
      config: options.db ? { db: options.db } : undefined,
    },
  ];
}

/** 用户层 patch 的形状（data/settings.json 里 `plugins` 命名空间） */
export interface PluginPatchConfig {
  disabled?: boolean;
  /** 整块替换该条目的 config（不深合并） */
  config?: unknown;
}

/** 把 `plugins` 命名空间的配置转成 loader 的 patch 列表 */
export function toPluginPatches(config: Record<string, PluginPatchConfig>): PluginPatch[] {
  return Object.entries(config).map(([id, patch]) => {
    const entry: PluginPatch = { id };
    if (patch.disabled !== undefined) entry.disabled = patch.disabled;
    if ("config" in patch) entry.config = patch.config;
    return entry;
  });
}
