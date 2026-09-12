// 宿主内核装配（组合根）：把 settings / docStore 等提供方插件挂到一棵内核上下文上。
//
// 这是"插件化"从抽象落到产品的那一步：
//   server/index.ts → bootHostKernel() → { ctx, settings } → 各路由 requireDocStore(ctx) 取服务
//
// 三条纪律（对齐 docs/插件化架构.md §2）：
//   1. 启动即审计：PENDING（缺依赖，插件不工作）与 FAILED 必须打印出来，
//      否则 inject 门控失败就是静默的（DSH 的教训）。
//   2. 配置从 settings 读，不再散落 process.env（env 仍是最高优先级来源）。
//   3. 依赖可注入（db / settingsPath）：测试不碰真实 data/lotion.db。
import type Database from "better-sqlite3";
import {
  Context,
  auditOk,
  formatAudit,
  formatLoadReport,
  loadPlugins,
  type AuditReport,
  type LoadReport,
  type PluginEntry,
} from "@/lib/kernel";
import { logger } from "@/lib/logger";
import { sqliteDocStorePlugin } from "@/lib/local/doc-store-sqlite";
import { settingsFilePlugin } from "@/lib/local/settings-file";
import { installLotionSettings, type LotionSettings } from "@/lib/local/lotion-config";
import { requireDocStore, type DocStore } from "@/lib/seams/doc-store";
import { findSettings } from "@/lib/seams/settings";

export interface HostKernel {
  /** 根上下文（路由/工具从这里取服务） */
  ctx: Context;
  /** 组合清单装配报告（稳定 id → fiber） */
  load: LoadReport;
  /** 配置命名空间句柄（ai / storage / server / logging） */
  settings: LotionSettings;
  /** 启动审计报告 */
  audit: AuditReport;
  /** 装配 + 审计的可读文本（启动日志一次打印） */
  startupText: string;
  /** 审计报告的可读文本（启动日志用） */
  auditText: string;
  /** 拆卸整棵内核（测试与优雅停机用） */
  dispose: () => Promise<void>;
}

export interface BootHostKernelOptions {
  /** 注入 SQLite 连接（测试传 :memory:）；省略时用进程单例（getDb） */
  db?: Database.Database;
  /** 注入用户层配置文件路径（测试传临时文件）；省略时用 resolveSettingsPath() */
  settingsPath?: string;
}

let current: HostKernel | null = null;

/**
 * 装配宿主内核（幂等：重复调用返回同一实例）。
 * 注意：调用前应已加载 .env（server/load-env.ts），因为 settings 的环境变量层在装配时读取。
 */
export function bootHostKernel(options: BootHostKernelOptions = {}): HostKernel {
  if (current) return current;

  const ctx = Context.createRoot({
    onError: (error, fiberName) => {
      logger.api.error(`[kernel] 插件「${fiberName}」激活失败`, {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  // 组合清单：每行必须有**稳定唯一 id**（loader 强制），便于 patch 定位与卸载
  const entries: PluginEntry[] = [
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
  const load = loadPlugins(ctx, entries);

  const settings = installLotionSettings(ctx);
  const audit = ctx.audit();
  const auditText = formatAudit(audit);

  if (!auditOk(audit)) {
    // 不阻断启动（缺服务可能是可选的），但必须让人看见
    logger.api.warn("[kernel] 装配审计未通过", {
      pending: audit.pending,
      failed: audit.failed,
    });
  }

  const kernel: HostKernel = {
    ctx,
    load,
    settings,
    audit,
    auditText,
    startupText: `${formatLoadReport(load)}\n${auditText}`,
    async dispose() {
      await load.dispose();
      await ctx.dispose();
      current = null;
    },
  };
  current = kernel;
  return kernel;
}

/** 取宿主内核；未装配即抛错（**不隐式装配**：避免测试/脚本意外碰到真实 data/lotion.db） */
export function getHostKernel(): HostKernel {
  if (!current) {
    throw new Error("宿主内核未装配：请在入口调用 bootHostKernel()（server/index.ts 已调用）");
  }
  return current;
}

/** 取宿主内核；未装配返回 null（可选消费者 / 测试环境降级用：回退到环境变量） */
export function getHostKernelIfBooted(): HostKernel | null {
  return current;
}

/** 便捷取用：宿主侧完整 docStore 契约 */
export function getHostDocStore(): DocStore {
  return requireDocStore(getHostKernel().ctx);
}

/** 便捷取用：AI 运行期配置（内核未装配时返回 undefined → 由消费方回退环境变量） */
export function getHostAiConfig(): { model: string; apiKey: string } | undefined {
  return current?.settings.ai.get();
}

/** 是否已装配（诊断用） */
export function isHostKernelBooted(): boolean {
  return current !== null;
}

/** 已装配的 settings 提供方（未挂载时 undefined） */
export function getHostSettingsProvider() {
  return current ? findSettings(current.ctx) : undefined;
}

/** 测试用：清空单例 */
export function _resetHostKernelForTest(): void {
  current = null;
}
