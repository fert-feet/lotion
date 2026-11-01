// 静态插件的热挂载控制器（宿主侧）。
//
// 共享 loader 的 fibers 表：启停就是 ctx.plugin()/fiber.dispose()，
// 配合 M4 的实时路由分发与 ctx.effect 配对的注销，路由/tools 会立即生效。
// 核心插件（settings/docStore 等）不交给本控制器 —— 由 manager 的 core 标记拦住。
import {
  FiberState,
  fiberError,
  provideService,
  readService,
  settle,
  type Context,
  type Fiber,
  type PluginEntry,
} from "@/lib/kernel";

export interface StaticPluginController {
  /** 挂载（已挂载则直接成功；FAILED 的旧 fiber 会先清理） */
  enable(id: string, config?: unknown): Promise<{ ok: boolean; error?: string }>;
  /** 卸载；不存在时静默 */
  disable(id: string): Promise<void>;
  running(id: string): boolean;
  /** 最近一次挂载失败原因 */
  error(id: string): string | undefined;
}

export interface CreateStaticPluginControllerOptions {
  ctx: Context;
  /** 组合清单（已应用用户 patch；含 disabled 条目，便于之后启用） */
  entries: readonly PluginEntry[];
  /** 与 loader 共享的 fiber 表（卸载时一并清理） */
  fibers: Map<string, Fiber>;
}

export function createStaticPluginController(
  options: CreateStaticPluginControllerOptions,
): StaticPluginController {
  const byId = new Map(options.entries.map((entry) => [entry.id, entry]));
  const errors = new Map<string, string>();

  return {
    async enable(id, config) {
      const entry = byId.get(id);
      if (!entry) return { ok: false, error: `未知静态插件「${id}」` };

      const existing = options.fibers.get(id);
      if (existing) {
        if (existing.state === FiberState.ACTIVE) return { ok: true };
        // 启动时 FAILED / PENDING 的 fiber：先清掉再重试
        options.fibers.delete(id);
        await existing.dispose();
      }

      try {
        const fiber = options.ctx.plugin(
          entry.plugin as Parameters<Context["plugin"]>[0],
          config !== undefined ? config : entry.config,
        ) as unknown as Fiber;
        await settle(fiber);
        if (fiber.state === FiberState.FAILED) {
          const message = fiberError(fiber) ?? "插件激活失败";
          errors.set(id, message);
          return { ok: false, error: message };
        }
        options.fibers.set(id, fiber);
        errors.delete(id);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.set(id, message);
        return { ok: false, error: message };
      }
    },

    async disable(id) {
      const fiber = options.fibers.get(id);
      if (!fiber) {
        errors.delete(id);
        return;
      }
      options.fibers.delete(id);
      errors.delete(id);
      await fiber.dispose();
    },

    running(id) {
      return options.fibers.get(id)?.state === FiberState.ACTIVE;
    },

    error: (id) => errors.get(id),
  };
}

export const STATIC_PLUGIN_CONTROLLER_SERVICE = "staticPluginController";

export function provideStaticPluginController(
  ctx: Context,
  controller: StaticPluginController,
): void {
  provideService(ctx, STATIC_PLUGIN_CONTROLLER_SERVICE, controller);
}

export function findStaticPluginController(ctx: Context): StaticPluginController | undefined {
  return readService<StaticPluginController>(ctx, STATIC_PLUGIN_CONTROLLER_SERVICE);
}
