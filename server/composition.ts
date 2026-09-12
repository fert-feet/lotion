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
import type { Context, PluginEntry, PluginPatch } from "@/lib/kernel";
import { provideTools, requireTools } from "@/lib/seams/tools";
import { Hono } from "hono";
import { provideDynamic } from "@/lib/seams/dynamic";
import { requireHttpRoutes } from "@/lib/seams/http-routes";
import { requireAuth } from "./middleware";
import type { AppEnv, } from "./http";
import { createDynamicRunner } from "@/lib/dynamic/runner";
import { registerDynamicPluginTools } from "@/lib/dynamic/tools";
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
        apply: (ctx: Context) => provideTools(ctx, createHostTools()),
      },
    },
    {
      id: "settings-file",
      plugin: settingsFilePlugin,
      // 声明了 Config 的插件必须收到配置对象（至少 {}）
      config: { filePath: options.settingsPath },
    },
    {
      // 动态插件通道：**默认 disabled**（opt-in）。
      // 启用方式（改配置即可，不改代码）：data/settings.json
      //   { "plugins": { "dynamic-plugins": { "disabled": false } } }
      // ⚠️ 它不是安全边界：沙箱只收窄 API 面，暴露的服务与本机 shell 同级信任。
      id: "dynamic-plugins",
      disabled: true,
      plugin: {
        name: "dynamic-plugins",
        inject: ["tools", "httpRoutes"],
        apply: (ctx: Context) => {
          const runner = createDynamicRunner({
            ctx,
            // 白名单：动态插件只能注入这些服务（"能碰什么"显式化）
            allowedServices: ["tools"],
            onLog: (level, message) => console[level](message),
          });
          provideDynamic(ctx, runner);
          // 自指工具：模型借此查/写/跑/停自己的插件
          registerDynamicPluginTools(requireTools(ctx));

          // 客户端半边的下发通道：只回**已批准**的客户端半边，**绝不下发 host 代码**
          const dynamicRoutes = new Hono<AppEnv>();
          dynamicRoutes.use("*", requireAuth);
          dynamicRoutes.get("/plugins", (c) =>
            c.json(
              runner
                .list()
                .filter((record) => record.state === "approved" && record.definition.client)
                .map((record) => ({
                  id: record.definition.id,
                  title: record.definition.title,
                  description: record.definition.description ?? null,
                  client: record.definition.client,
                })),
            ),
          );
          requireHttpRoutes(ctx).route("/dynamic", dynamicRoutes);
        },
      },
    },
    {
      id: "doc-store-sqlite",
      plugin: sqliteDocStorePlugin,
      config: { db: options.db },
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
