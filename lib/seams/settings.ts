// 接缝：settings —— 两层配置层级（Service Definition）。
//
// 三角色：
//   Definition ← 本文件：SettingsProvider 契约 + installSettingsSection 两层语义 + 脱敏
//   Provider   ← lib/local/settings-file.ts（data/settings.json + 环境变量）
//   Consumer   ← 各插件（AI 模型/key、端口、存储路径、日志级别…）
//
// **两层配置层级**（照搬 DSH packages/settings/settings/src/index.ts:863 的语义）：
//   1. 组合层（插件自带的默认值）= `base`，永远存在 → **设置服务缺失时回退到它，而不是失败**
//   2. 用户层（data/settings.json）覆盖 base
//   3. 环境变量（部署方注入）覆盖前两者
//   schema 只有一份：既是运行期校验器，也是取值类型来源（zod 4 满足 Standard Schema）
//
// ⚠️ 保持环境无关（浏览器/服务端共用）：不 import node:/React。
import type { z } from "zod";
import { Context, provideService, readService } from "@/lib/kernel";
import type { Disposer } from "@/lib/kernel";

export interface SettingsSectionOptions<T> {
  /** 字段 → 环境变量名（环境变量优先级最高；空值视为未设置） */
  env?: Partial<Record<keyof T & string, string>>;
  /** 需要脱敏的字段（describe() 用）；省略时按字段名自动判定（key/secret/token/password） */
  secretFields?: readonly (keyof T & string)[];
}

/** 一个命名空间的配置读写句柄 */
export interface SettingsSection<T> {
  readonly namespace: string;
  /** 当前生效值（env > 用户层 > 组合层） */
  get(): T;
  /** 写入用户层（持久化由 Provider 负责） */
  set(patch: Partial<T>): Promise<void>;
  /** 订阅变更；返回取消订阅函数 */
  onChange(listener: (value: T) => void): Disposer;
  /** 停止本 section 的监听与回退逻辑 */
  dispose(): void;
}

/** 已注册命名空间的描述（供设置界面；secret 字段已脱敏） */
export interface SettingsNamespaceInfo {
  namespace: string;
  /** 生效值（secret 字段为掩码字符串） */
  value: Record<string, unknown>;
}

/** settings 服务契约（Provider 实现） */
export interface SettingsProvider {
  /**
   * 注册命名空间（一个命名空间一个所有者；重复注册抛错）。
   * 返回句柄：get/set/onChange 均基于两层合并结果。
   */
  register<T>(
    namespace: string,
    schema: z.ZodType<T>,
    options: { base: T; env?: SettingsSectionOptions<T>["env"]; secretFields?: SettingsSectionOptions<T>["secretFields"] },
  ): SettingsSection<T>;
  /** 列出全部命名空间及其生效值（secret 已脱敏） */
  describe(): SettingsNamespaceInfo[];
}

/** 服务 key */
export const SETTINGS_SERVICE = "settings";

/** 装配 settings 实现 */
export function provideSettings(ctx: Context, provider: SettingsProvider): void {
  for (const method of ["register", "describe"] as const) {
    if (typeof (provider as unknown as Record<string, unknown>)[method] !== "function") {
      throw new Error(`settings 实现不完整，缺少方法：${method}`);
    }
  }
  provideService(ctx, SETTINGS_SERVICE, provider);
}

/** 读 settings；未装配返回 undefined（可选依赖降级用） */
export function findSettings(ctx: Context): SettingsProvider | undefined {
  return readService<SettingsProvider>(ctx, SETTINGS_SERVICE);
}

/** 读 settings；未装配抛错 */
export function requireSettings(ctx: Context): SettingsProvider {
  const provider = findSettings(ctx);
  if (!provider) {
    throw new Error(
      `settings 未装配：请确认组合清单里挂载了 settings 提供方插件（服务 key「${SETTINGS_SERVICE}」）`,
    );
  }
  return provider;
}

/**
 * 声明式安装一个配置命名空间（插件最常用的入口）：
 * - **没有 settings 服务时也能工作**：先用组合默认值 `base`，服务出现后自动切换到两层合并值，
 *   服务消失时回退到 `base`（并重新判定派生值）——这就是"优雅降级"。
 * - `set()` 在无 settings 服务时抛错（写操作必须落到持久层，不能假装成功）。
 */
export function installSettingsSection<T>(
  ctx: Context,
  namespace: string,
  schema: z.ZodType<T>,
  base: T,
  options: SettingsSectionOptions<T> = {},
): SettingsSection<T> {
  let current: T = base;
  /** 当前生效的 Provider 句柄（由 inject 门控装配；无服务时为 null） */
  let activeHandle: SettingsSection<T> | null = null;
  const listeners = new Set<(value: T) => void>();
  const emit = (value: T) => {
    for (const listener of [...listeners]) listener(value);
  };
  const setCurrent = (value: T) => {
    current = value;
    emit(value);
  };

  const section: SettingsSection<T> = {
    namespace,
    get: () => current,
    async set(patch) {
      // 用门控装配好的句柄写入：重复 register 会被 Provider 拒绝（一个命名空间一个所有者）
      if (!activeHandle) {
        throw new Error(
          `无法写入配置「${namespace}」：settings 服务未装配（请挂载 settings 提供方插件）`,
        );
      }
      await activeHandle.set(patch);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      listeners.clear();
      activeHandle = null;
      current = base;
    },
  };

  // 依赖门控：settings 出现即接入两层合并值；消失即回退组合默认
  ctx.inject([SETTINGS_SERVICE], (consumerCtx) => {
    const provider = requireSettings(consumerCtx);
    const handle = provider.register(namespace, schema, {
      base,
      env: options.env,
      secretFields: options.secretFields,
    });
    activeHandle = handle;
    setCurrent(handle.get());
    const off = handle.onChange(setCurrent);
    return () => {
      off();
      handle.dispose();
      activeHandle = null;
      // 服务消失：回退到组合层默认值（消费方继续可用，只是退回默认配置）
      setCurrent(base);
    };
  });

  return section;
}

/** 自动判定 secret 字段名（key/secret/token/password 结尾或包含） */
export function isSecretField(field: string): boolean {
  return /(key|secret|token|password)/i.test(field);
}

/** 脱敏：保留首尾各若干字符，其余打码（值过短则全码） */
export function maskSecret(value: unknown): string {
  const text = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  if (text.length === 0) return "";
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}
