// settings 的宿主侧实现（Service Provider）：data/settings.json（用户层）+ 环境变量。
//
// ⚠️ 服务端专用（读写文件系统）。
// 解析顺序（后写的赢）：组合默认 base → 用户层文件 → 环境变量。
// 用户层校验失败时**不炸进程**：记日志并退回 base/env —— 手改坏的配置文件不该让 app 起不来。
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PluginObject } from "@/lib/kernel";
import { logger } from "@/lib/logger";
import {
  isSecretField,
  maskSecret,
  provideSettings,
  type SettingsNamespaceInfo,
  type SettingsProvider,
  type SettingsSection,
  type SettingsSectionOptions,
} from "@/lib/seams/settings";

/** 用户层配置文件路径（可用 LOTION_SETTINGS_PATH 覆盖，测试注入用） */
export function resolveSettingsPath(): string {
  return process.env.LOTION_SETTINGS_PATH ?? path.join(process.cwd(), "data", "settings.json");
}

interface Registration {
  schema: z.ZodType<unknown>;
  base: Record<string, unknown>;
  env: Record<string, string> | undefined;
  secretFields: readonly string[] | undefined;
  listeners: Set<(value: unknown) => void>;
  current: unknown;
}

export interface SettingsFileProvider extends SettingsProvider {
  /** 重新从磁盘加载用户层并通知所有命名空间（文件被外部修改时用） */
  reload(): void;
}

export interface CreateSettingsFileProviderOptions {
  /** 配置文件路径，默认 resolveSettingsPath() */
  filePath?: string;
}

/** 读用户层文件（缺失/解析失败 → 空对象，并按需记日志） */
function readUserLayer(filePath: string): Record<string, Record<string, unknown>> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logger.settings.warn("[settings] 用户配置文件不是对象，已忽略", { filePath });
      return {};
    }
    return parsed as Record<string, Record<string, unknown>>;
  } catch (error) {
    logger.settings.warn("[settings] 用户配置文件解析失败，已忽略", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/** 从环境变量取覆盖值（只收非空字符串） */
function envLayer(
  env: Record<string, string> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, name] of Object.entries(env ?? {})) {
    const value = process.env[name];
    if (value !== undefined && value !== "") out[field] = value;
  }
  return out;
}

/**
 * 构造 settings 实现（两层配置层级）。
 * @param options.filePath - 用户层文件路径（测试可注入临时文件）
 */
export function createSettingsFileProvider(
  options: CreateSettingsFileProviderOptions = {},
): SettingsFileProvider {
  const filePath = options.filePath ?? resolveSettingsPath();
  const registrations = new Map<string, Registration>();

  /** 计算某命名空间的生效值：base → 用户层 → env，逐层校验 */
  const compute = (namespace: string): unknown => {
    const reg = registrations.get(namespace);
    if (!reg) return undefined;
    const userLayer = readUserLayer(filePath)[namespace] ?? {};
    const fromEnv = envLayer(reg.env);

    const attempt = (candidate: Record<string, unknown>, layer: string) => {
      const parsed = reg.schema.safeParse(candidate);
      if (parsed.success) return parsed.data;
      logger.settings.warn(`[settings] 「${namespace}」${layer}校验失败，已忽略该层`, {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      return undefined;
    };

    // 1) base + 用户层 + env
    const full = attempt({ ...reg.base, ...userLayer, ...fromEnv }, "合并值");
    if (full !== undefined) return full;
    // 2) 用户层坏掉时：base + env（env 是部署方注入的，仍应生效）
    const withoutUser = attempt({ ...reg.base, ...fromEnv }, "（退回 base+env）");
    if (withoutUser !== undefined) return withoutUser;
    // 3) 最后兜底：组合默认
    return reg.base;
  };

  const recompute = (namespace: string) => {
    const reg = registrations.get(namespace);
    if (!reg) return;
    const next = compute(namespace);
    reg.current = next;
    for (const listener of [...reg.listeners]) listener(next);
  };

  const writeUserLayer = (namespace: string, patch: Record<string, unknown>) => {
    const all = readUserLayer(filePath);
    const merged = { ...(all[namespace] ?? {}), ...patch };
    const next = { ...all, [namespace]: merged };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n", "utf-8");
  };

  const provider: SettingsFileProvider = {
    register<T>(
      namespace: string,
      schema: z.ZodType<T>,
      opts: {
        base: T;
        env?: SettingsSectionOptions<T>["env"];
        secretFields?: SettingsSectionOptions<T>["secretFields"];
      },
    ): SettingsSection<T> {
      const existing = registrations.get(namespace);
      if (existing) {
        // 同一命名空间重复注册：抛错（一个命名空间一个所有者），避免两个插件偷偷抢配置
        throw new Error(`配置命名空间「${namespace}」已被注册，不能重复注册`);
      }
      const reg: Registration = {
        schema: schema as unknown as z.ZodType<unknown>,
        base: opts.base as Record<string, unknown>,
        env: opts.env as Record<string, string> | undefined,
        secretFields: opts.secretFields as readonly string[] | undefined,
        listeners: new Set(),
        current: opts.base,
      };
      registrations.set(namespace, reg);
      reg.current = compute(namespace);

      return {
        namespace,
        get: () => registrations.get(namespace)?.current as T,
        async set(patch: Partial<T>) {
          writeUserLayer(namespace, patch as Record<string, unknown>);
          recompute(namespace);
        },
        onChange(listener) {
          const entry = listener as (value: unknown) => void;
          reg.listeners.add(entry);
          return () => {
            reg.listeners.delete(entry);
          };
        },
        dispose() {
          reg.listeners.clear();
          registrations.delete(namespace);
        },
      };
    },

    describe(): SettingsNamespaceInfo[] {
      return [...registrations.entries()].map(([namespace, reg]) => {
        const value = { ...(reg.current as Record<string, unknown>) };
        for (const field of Object.keys(value)) {
          const secret = reg.secretFields ? reg.secretFields.includes(field) : isSecretField(field);
          if (secret) value[field] = maskSecret(value[field]);
        }
        return { namespace, value };
      });
    },

    reload() {
      for (const namespace of registrations.keys()) recompute(namespace);
    },
  };

  return provider;
}

/** 插件配置的 Standard Schema（Cordis 在插件启动**之前**校验；非法则 fiber FAILED、apply 不执行） */
export const settingsFileConfig = z.object({
  /** 用户层配置文件路径；省略则用 resolveSettingsPath() */
  filePath: z.string().min(1).optional(),
});

/**
 * 装配插件：把 settings 提供方挂到内核上（组合清单里的一行）。
 * ⚠️ 声明了 `Config` 的插件**必须收到配置对象**（至少 `{}`）—— Cordis 会先校验再启动，
 * 完全不传 config 会被判为校验失败（组合清单里因此始终传对象）。
 */
export const settingsFilePlugin: PluginObject = {
  name: "settings-file",
  Config: settingsFileConfig,
  apply(ctx, config?: unknown) {
    const { filePath } = settingsFileConfig.parse(config ?? {});
    provideSettings(ctx, createSettingsFileProvider(filePath ? { filePath } : {}));
  },
};
