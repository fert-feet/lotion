// 接缝：plugins —— 插件管理能力（Service Definition，宿主 + 浏览器两侧共用）。
//
// 为什么需要它：插件系统此前只有"装配期清单"，没有产品侧的列表/启停/配置/审批入口。
// 管理操作是**写操作**，不能走 remote 接缝（remote 刻意只读且是动态插件的白名单边界）。
//
// 三角色：
//   Definition ← 本文件：PluginInfo / 配置字段 / PluginAdminService 契约
//   Provider   ← 宿主 lib/local/plugin-manager.ts；浏览器 lib/client/plugin-admin-rest.ts
//   Consumer   ← 设置弹窗（插件页）、启动期的 UI 插件过滤
//
// ⚠️ 保持环境无关（浏览器/服务端共用）：不 import node:/React/服务端模块。
import { provideService, readService, type Context } from "@/lib/kernel";

/** 插件所在的一端：宿主（Node）或浏览器（UI） */
export type PluginScope = "host" | "ui";

/** 插件来源：仓库内置 / 用户安装 / 模型运行时定义 */
export type PluginSource = "builtin" | "installed" | "dynamic";

/** 运行状态（面向 UI 的收敛枚举） */
export type PluginStatus = "active" | "disabled" | "error" | "pending" | "stopped";

/** 配置字段的描述（设置界面据此生成表单） */
export interface PluginConfigField {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "secret";
  description?: string;
  placeholder?: string;
  options?: readonly string[];
  default?: unknown;
}

/** 一个插件的可管理视图 */
export interface PluginInfo {
  id: string;
  title: string;
  description: string;
  scope: PluginScope;
  source: PluginSource;
  version: string;
  enabled: boolean;
  /** 客户端半边是否已审批（内置/无客户端半边的插件恒为 true） */
  approved: boolean;
  /** 核心插件不可禁用（禁用会导致应用不可用） */
  core: boolean;
  /** 改动是否需要重启/刷新才生效 */
  restartRequired: boolean;
  status: PluginStatus;
  error?: string;
  config: Record<string, unknown>;
  configFields: readonly PluginConfigField[];
  capabilities: readonly string[];
}

/** 代码预览（只给 owner） */
export interface PluginSourceCode {
  host?: string;
  client?: string;
}

/** 市场条目（M3）：bundle 是同源或 HTTPS 的 JSON 地址 */
export interface MarketEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  bundle: string;
}

/** 启动期客户端配置：只暴露 disabled 的 UI 插件 id（不泄露任何代码/配置） */
export interface ClientPluginConfig {
  disabledUi: string[];
}

export interface PluginAdminService {
  list(): Promise<PluginInfo[]>;
  setEnabled(id: string, enabled: boolean): Promise<PluginInfo>;
  setConfig(id: string, config: Record<string, unknown>): Promise<PluginInfo>;
  /** 批准客户端半边运行（动态/已安装插件） */
  approve(id: string): Promise<PluginInfo>;
  run(id: string): Promise<PluginInfo>;
  stop(id: string): Promise<PluginInfo>;
  /** 卸载已安装插件 / 删除动态定义 */
  remove(id: string): Promise<void>;
  /** 代码预览 */
  source(id: string): Promise<PluginSourceCode>;
  market(): Promise<MarketEntry[]>;
  install(id: string): Promise<PluginInfo>;
  clientConfig(): Promise<ClientPluginConfig>;
}

export const PLUGIN_ADMIN_SERVICE = "pluginAdmin";

const REQUIRED_METHODS = [
  "list",
  "setEnabled",
  "setConfig",
  "approve",
  "run",
  "stop",
  "remove",
  "source",
  "market",
  "install",
  "clientConfig",
] as const;

/** 装配实现（形状校验在装配期一次性完成，避免运行到一半才发现缺方法） */
export function providePluginAdmin(ctx: Context, admin: PluginAdminService): void {
  for (const method of REQUIRED_METHODS) {
    if (typeof (admin as unknown as Record<string, unknown>)[method] !== "function") {
      throw new Error(`pluginAdmin 实现不完整，缺少方法：${method}`);
    }
  }
  provideService(ctx, PLUGIN_ADMIN_SERVICE, admin);
}

/** 读插件管理服务；未装配返回 undefined */
export function findPluginAdmin(ctx: Context): PluginAdminService | undefined {
  return readService<PluginAdminService>(ctx, PLUGIN_ADMIN_SERVICE);
}

/** 读插件管理服务；未装配抛错 */
export function requirePluginAdmin(ctx: Context): PluginAdminService {
  const admin = findPluginAdmin(ctx);
  if (!admin) {
    throw new Error(
      `pluginAdmin 未装配：请确认组合清单里挂载了 plugin-manager（服务 key「${PLUGIN_ADMIN_SERVICE}」）`,
    );
  }
  return admin;
}
