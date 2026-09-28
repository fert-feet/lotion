// Lotion 自身的配置命名空间声明（**组合层**默认值 + 环境变量映射）。
//
// 两层配置层级：组合默认（本文件）→ 用户层（data/settings.json）→ 环境变量。
// schema 只有一份：既做运行期校验，也是类型来源。
//
// ⚠️ 宿主侧模块（用到 node:path / process.cwd）：浏览器不需要这些值，
// 将来 UI 若需要展示（例如"API Key 是否已配置"），另开一个只读端点，不要把本模块带进客户端。
//
// 迁入的既有配置（此前散落在各处直接读 process.env）：
//   DEEPSEEK_API_KEY / AI_MODEL  → ai.apiKey / ai.model
//   LOTION_DB_PATH / UPLOAD_DIR  → storage.dbPath / storage.uploadDir
//   PORT                         → server.port
//   LOG_LEVEL                    → logging.level
import path from "node:path";
import { z } from "zod";
import type { Context } from "@/lib/kernel";
import { installSettingsSection, type SettingsSection } from "@/lib/seams/settings";

/** AI 助手配置（apiKey 是 secret：describe() 输出与日志一律脱敏） */
export const aiSettingsSchema = z.object({
  /** DeepSeek API Key；空字符串 = 未配置（AI 面板会明确提示） */
  apiKey: z.string().default(""),
  /** 模型名（AI 对话与上下文压缩共用） */
  model: z.string().min(1).default("deepseek-flash"),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const storageSettingsSchema = z.object({
  /** SQLite 库路径 */
  dbPath: z.string().min(1),
  /** 上传目录 */
  uploadDir: z.string().min(1),
});
export type StorageSettings = z.infer<typeof storageSettingsSchema>;

export const serverSettingsSchema = z.object({
  /** Hono 监听端口（环境变量是字符串，用 coerce 后仍由 schema 兜底非法值） */
  port: z.coerce.number().int().min(1).max(65535).default(3001),
});
export type ServerSettings = z.infer<typeof serverSettingsSchema>;

/** 装配 patch：按插件 id 覆盖 config 或禁用条目（见 server/composition.ts） */
export const pluginsSettingsSchema = z.record(
  z.string(),
  z.looseObject({ disabled: z.boolean().optional(), config: z.unknown().optional() }),
);
export type PluginsSettings = z.infer<typeof pluginsSettingsSchema>;

export const loggingSettingsSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export type LoggingSettings = z.infer<typeof loggingSettingsSchema>;

/** 四个命名空间的读写句柄（消费方按需取用） */
export interface LotionSettings {
  ai: SettingsSection<AiSettings>;
  /** 插件装配 patch（用户层可停用/改配置某个插件） */
  plugins: SettingsSection<PluginsSettings>;
  storage: SettingsSection<StorageSettings>;
  server: SettingsSection<ServerSettings>;
  logging: SettingsSection<LoggingSettings>;
}

/** 组合层默认值（唯一声明处；env 映射名与 README/docs 一致，有单测钉住） */
export function lotionSettingsDefaults(cwd = process.cwd()) {
  return {
    ai: { apiKey: "", model: "deepseek-flash" } satisfies AiSettings,
    storage: {
      dbPath: path.join(cwd, "data", "lotion.db"),
      uploadDir: path.join(cwd, "data", "uploads"),
    } satisfies StorageSettings,
    server: { port: 3001 } satisfies ServerSettings,
    logging: { level: "info" } satisfies LoggingSettings,
    plugins: {} satisfies PluginsSettings,
  };
}

/**
 * 在给定内核上下文里安装全部 Lotion 配置命名空间（组合清单里的一行）。
 * 无 settings 提供方时也能工作：各 section 先用组合默认值。
 */
export function installLotionSettings(ctx: Context, cwd?: string): LotionSettings {
  const base = lotionSettingsDefaults(cwd);

  return {
    ai: installSettingsSection(ctx, "ai", aiSettingsSchema, base.ai, {
      env: { apiKey: "DEEPSEEK_API_KEY", model: "AI_MODEL" },
    }),
    storage: installSettingsSection(ctx, "storage", storageSettingsSchema, base.storage, {
      env: { dbPath: "LOTION_DB_PATH", uploadDir: "UPLOAD_DIR" },
    }),
    server: installSettingsSection(ctx, "server", serverSettingsSchema, base.server, {
      env: { port: "PORT" },
    }),
    plugins: installSettingsSection(ctx, "plugins", pluginsSettingsSchema, base.plugins),
    logging: installSettingsSection(ctx, "logging", loggingSettingsSchema, base.logging, {
      env: { level: "LOG_LEVEL" },
    }),
  };
}
