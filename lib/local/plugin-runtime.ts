// 已安装插件的宿主半边运行时。
//
// 与动态 runner 的区别：
//   * 定义来自磁盘（data/plugins/installed），不是模型现场写的；
//   * 启动时按 enabled 直接挂载（宿主半边不需要审批；客户端半边需要 approved）；
//   * tools 贡献可随卸载撤销；httpRoutes 贡献受当前注册表限制，禁用需重启（M4 再解）。
//
// ⚠️ 服务端专用。沙箱依旧**不是安全边界**：只收窄 API 面。
import { FiberState, fiberError, provideService, readService, settle, type Context, type Fiber } from "@/lib/kernel";
import { evaluateHostHalf } from "@/lib/dynamic/sandbox";
import type { InstalledPluginManifest, PluginPackageStore } from "./plugin-package";

export interface InstalledPluginRuntime {
  /** 挂载宿主半边（无 host 代码视为成功） */
  mount(id: string): Promise<{ ok: boolean; error?: string }>;
  /** 卸载宿主半边（已挂载的 tools 会随 fiber 回收） */
  unmount(id: string): Promise<void>;
  /** 启动时按 enabled 挂载全部 host 半边 */
  startAll(): Promise<void>;
  runningIds(): string[];
  /** 最近一次挂载失败原因（给设置界面） */
  error(id: string): string | undefined;
  dispose(): Promise<void>;
}

export interface CreateInstalledPluginRuntimeOptions {
  ctx: Context;
  store: PluginPackageStore;
  onLog?: (level: "log" | "warn" | "error", message: string) => void;
}

export function createInstalledPluginRuntime(
  options: CreateInstalledPluginRuntimeOptions,
): InstalledPluginRuntime {
  const fibers = new Map<string, Fiber>();
  const errors = new Map<string, string>();

  const allowedServicesFor = (manifest: InstalledPluginManifest): Set<string> => {
    const allowed = new Set<string>();
    if (manifest.capabilities.includes("tools")) allowed.add("tools");
    if (manifest.capabilities.includes("httpRoutes")) allowed.add("httpRoutes");
    return allowed;
  };

  const fail = (id: string, message: string) => {
    errors.set(id, message);
    return { ok: false, error: message };
  };

  const mount: InstalledPluginRuntime["mount"] = async (id) => {
    if (fibers.has(id)) return { ok: true };
    const manifest = options.store.get(id);
    if (!manifest) return fail(id, `未安装插件「${id}」`);
    if (!manifest.host) return { ok: true };

    const evaluated = await evaluateHostHalf(manifest.host, {
      id,
      context: options.ctx,
      onLog: options.onLog,
    });
    if (!evaluated.ok) return fail(id, evaluated.error);

    const allowed = allowedServicesFor(manifest);
    const forbidden = (evaluated.plugin.inject ?? []).filter((name) => !allowed.has(name));
    if (forbidden.length > 0) {
      return fail(id, `注入的服务不在能力声明内：${forbidden.join("、")}`);
    }

    try {
      const fiber = options.ctx.plugin(
        evaluated.plugin as unknown as Parameters<Context["plugin"]>[0],
        // 第二参就是 manifest.configValues：插件 apply(ctx, config) 可直接读取
        manifest.configValues,
      ) as unknown as Fiber;
      await settle(fiber);
      if (fiber.state === FiberState.FAILED) {
        return fail(id, fiberError(fiber) ?? "插件激活失败");
      }
      fibers.set(id, fiber);
      errors.delete(id);
      return { ok: true };
    } catch (error) {
      return fail(id, error instanceof Error ? error.message : String(error));
    }
  };

  const unmount: InstalledPluginRuntime["unmount"] = async (id) => {
    const fiber = fibers.get(id);
    fibers.delete(id);
    errors.delete(id);
    if (fiber) await fiber.dispose();
  };

  return {
    mount,
    unmount,
    async startAll() {
      for (const manifest of options.store.list()) {
        if (manifest.enabled && manifest.host) await mount(manifest.id);
      }
    },
    runningIds: () => [...fibers.keys()],
    error: (id) => errors.get(id),
    async dispose() {
      for (const id of [...fibers.keys()]) await unmount(id);
    },
  };
}

export const INSTALLED_RUNTIME_SERVICE = "installedPluginRuntime";

export function provideInstalledRuntime(ctx: Context, runtime: InstalledPluginRuntime): void {
  provideService(ctx, INSTALLED_RUNTIME_SERVICE, runtime);
}

export function findInstalledRuntime(ctx: Context): InstalledPluginRuntime | undefined {
  return readService<InstalledPluginRuntime>(ctx, INSTALLED_RUNTIME_SERVICE);
}
