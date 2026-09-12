// Lotion 内核：极简 Cordis 式服务容器（自研，无第三方依赖）。
//
// 五个概念（对齐 DSH docs/cordis-primer.zh.md:9-13）：
//   1. 插件 = 向共享上下文贡献服务 / 事件 / 可逆副作用的对象
//   2. 上下文 = 服务容器：服务占据稳定的 `ctx.<key>`，消费方按 key 查找而非 import 实现
//   3. `inject` 声明依赖：依赖齐备才激活 → 加载顺序由依赖图求解，不手工编排
//   4. 事件通信：emit / waterfall / parallel / serial 四种分发模式
//   5. 注册是可逆副作用：卸载时按预期撤销（fiber 统一回收）
//
// 有意**不做**（见 docs/插件化架构.md §0）：isolate realm、动态 patch 层、双半边分发、
// 权限模型（唯一的强制边界留给 P5 的客户端 RPC 白名单）。
import { EventBus } from "./events";
import type { KernelArgs, KernelEventName, SerialListener, WaterfallListener } from "./events";
import { Fiber, FiberState, type Disposer } from "./fiber";

/** 插件对象形态：带可选 `name` / `inject` 与 `apply` */
export interface PluginObject {
  name?: string;
  /** 依赖的服务 key 列表；全部就绪才激活（缺失时保持 PENDING，可被审计发现） */
  inject?: readonly string[];
  apply: (ctx: Context, config?: unknown) => void | Disposer | Promise<void | Disposer>;
}

/** 插件函数形态：`(ctx, config) => void | Disposer` */
export type PluginFunction = (
  ctx: Context,
  config?: unknown,
) => void | Disposer | Promise<void | Disposer>;

export type Plugin = PluginObject | PluginFunction;

export interface MountOptions {
  /** 覆盖插件名（用于审计报告与错误信息） */
  name?: string;
  config?: unknown;
}

export interface RootOptions {
  /** 报错出口（apply 抛错 / 异步 disposer 失败的兜底），默认 console.error */
  onError?: (error: unknown, fiberName: string) => void;
}

interface ServiceEntry {
  value: unknown;
  owner: number;
  ownerName: string;
}

/** 依赖门：依赖齐备时激活；激活内容挂在独立子 fiber 上，依赖消失时可单独回卷 */
interface Waiter {
  keys: readonly string[];
  owner: Fiber;
  label: string;
  active: Fiber | null;
  missing: string[];
  /** 激活动作（`inject()` 与 `plugin()` 共用）：由调用方在 settle 时执行 */
  activate: (() => void) | null;
}

export interface AuditReport {
  /** 已挂载的活跃 fiber 数 */
  fibers: number;
  /** 未激活（缺依赖）的 fiber：名字 + 缺失服务 */
  pending: Array<{ name: string; missing: string[] }>;
  /** 激活失败的 fiber */
  failed: Array<{ name: string; error: string }>;
  /** 已注册服务 key */
  services: string[];
  /** 已注册监听器数 */
  listeners: number;
}

function isPromise(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Promise<unknown>).then === "function"
  );
}

/**
 * 上下文（服务容器 + 插件挂载点 + 事件入口）。
 * 每个插件拿到一个**子上下文**：其注册归属该插件的 fiber，卸载即整体撤销。
 */
export class Context {
  private readonly root: RootState;
  readonly fiber: Fiber;

  private constructor(root: RootState, fiber: Fiber) {
    this.root = root;
    this.fiber = fiber;
  }

  /** 创建根上下文（应用唯一入口） */
  static createRoot(options: RootOptions = {}): Context {
    const root: RootState = {
      services: new Map(),
      waiters: new Set(),
      fibers: new Set(),
      bus: new EventBus(),
      uid: 0,
      onError:
        options.onError ??
        ((error, fiberName) => console.error(`[kernel] 插件「${fiberName}」出错:`, error)),
    };
    const fiber = new Fiber(++root.uid, "root");
    fiber.state = FiberState.ACTIVE;
    root.fibers.add(fiber);
    return new Context(root, fiber);
  }

  // ---- 服务 ----

  /**
   * 注册服务。**同名二次注册抛错**——这就是"一个 key 一个提供方"的全部机制。
   * 服务随提供方 fiber 拆卸而消失，依赖方会自动回到 PENDING。
   */
  provide(key: string, value: unknown): void {
    const existing = this.root.services.get(key);
    if (existing) {
      throw new Error(`服务「${key}」已由插件「${existing.ownerName}」提供，不能重复注册`);
    }
    this.root.services.set(key, { value, owner: this.fiber.uid, ownerName: this.fiber.name });
    this.root.bus.emit("kernel/service-added", key);
    this.fiber.effect(() => {
      const entry = this.root.services.get(key);
      if (entry && entry.owner === this.fiber.uid) {
        this.root.services.delete(key);
        this.root.bus.emit("kernel/service-removed", key);
        this.settle();
      }
    });
    this.settle();
  }

  /** 读服务；缺席返回 undefined（可选依赖用它降级，而非 inject 门控） */
  get<T = unknown>(key: string): T | undefined {
    return this.root.services.get(key)?.value as T | undefined;
  }

  /** 是否有提供方 */
  has(key: string): boolean {
    return this.root.services.has(key);
  }

  /** 已注册的服务 key（审计/调试） */
  get serviceKeys(): string[] {
    return [...this.root.services.keys()];
  }

  // ---- 依赖门控 ----

  /**
   * 声明依赖并注册"就绪后执行"的回调。
   * - 依赖齐备 → 立即执行；否则挂为 PENDING（缺失服务可在 audit() 里看到）
   * - 依赖**消失** → 自动回卷该回调的注册，回到 PENDING；再次齐备会重新执行
   * - 返回值：手动撤销
   */
  inject(
    keys: readonly string[],
    callback: (ctx: Context) => void | Disposer | Promise<void | Disposer>,
  ): () => void {
    const waiter: Waiter = {
      keys,
      owner: this.fiber,
      label: this.fiber.name,
      active: null,
      missing: [...keys],
      activate: () => {
        // 激活内容挂在 active fiber 上：依赖消失时整体回卷，不影响调用方 fiber 的其它注册
        const fiber = waiter.active;
        if (!fiber) return;
        const result = callback(this.childContext(fiber));
        attachResult(fiber, result);
      },
    };
    this.root.waiters.add(waiter);
    this.fiber.effect(() => {
      this.root.waiters.delete(waiter);
      const active = waiter.active;
      waiter.active = null;
      return active ? active.dispose() : undefined;
    });
    this.settle();
    return () => {
      this.root.waiters.delete(waiter);
      const active = waiter.active;
      waiter.active = null;
      void active?.dispose();
    };
  }

  // ---- 插件 ----

  /**
   * 挂载插件：创建子 fiber（归属当前上下文），依赖齐备则执行 apply。
   * 返回该插件的 fiber —— `fiber.dispose()` 即卸载。
   */
  plugin(plugin: Plugin, options: MountOptions = {}): Fiber {
    const object: PluginObject = typeof plugin === "function" ? { apply: plugin } : plugin;
    const name = options.name ?? object.name ?? `plugin#${this.root.uid + 1}`;
    const fiber = newFiber(this.root, name, this.fiber);
    const apply = () => {
      const child = this.childContext(fiber);
      attachResult(fiber, object.apply(child, options.config));
    };

    const inject = object.inject ?? [];
    if (inject.length === 0) {
      fiber.state = FiberState.ACTIVE;
      runActivation(this.root, fiber, apply, true);
      return fiber;
    }
    // 依赖门控：activate 挂在独立子 fiber 上，依赖消失时可单独回卷
    const waiter: Waiter = {
      keys: inject,
      owner: fiber,
      label: name,
      active: null,
      missing: [...inject],
      activate: apply,
    };
    this.root.waiters.add(waiter);
    fiber.effect(() => {
      this.root.waiters.delete(waiter);
    });
    this.settle();
    return fiber;
  }

  // ---- 可逆副作用 ----

  /** 登记副作用：`fn` 返回 disposer，fiber 卸载时逆序调用 */
  effect(fn: Disposer): void {
    this.fiber.effect(fn);
  }

  // ---- 事件 ----
  //
  // 分发模式是事件的公开契约（对齐 DSH docs/cordis-primer.zh.md:28）：
  // 观察类事件用 `on`，环绕中间件用 `onWaterfall`，有返回值的串行链用 `onSerial`。
  // 三种注册都归属当前 fiber，卸载即移除。

  /** 注册观察型监听器（emit / parallel 分发） */
  on<K extends KernelEventName>(name: K, listener: (...args: KernelArgs<K>) => void): () => void {
    return this.root.bus.add(this.fiber.uid, name, listener as (...args: never[]) => unknown);
  }

  /**
   * 注册 waterfall（环绕中间件）监听器：`(…args, next) => R`。
   * 必须调用 `next()` 才委托下游；直接返回即短路——守卫型事件的拒绝语义。
   */
  onWaterfall<K extends KernelEventName, R = unknown>(
    name: K,
    listener: WaterfallListener<K, R>,
  ): () => void {
    return this.root.bus.add(this.fiber.uid, name, listener as (...args: never[]) => unknown);
  }

  /** 注册 serial（按序执行、返回值透出）监听器 */
  onSerial<K extends KernelEventName, R = unknown>(
    name: K,
    listener: SerialListener<K, R>,
  ): () => void {
    return this.root.bus.add(this.fiber.uid, name, listener as (...args: never[]) => unknown);
  }

  emit<K extends KernelEventName>(name: K, ...args: KernelArgs<K>): void {
    this.root.bus.emit(name, ...args);
  }

  waterfall<K extends KernelEventName, R = unknown>(name: K, ...args: KernelArgs<K>): R {
    return this.root.bus.waterfall<K, R>(name, ...args);
  }

  parallel<K extends KernelEventName>(name: K, ...args: KernelArgs<K>): Promise<void> {
    return this.root.bus.parallel(name, ...args);
  }

  serial<K extends KernelEventName, R = unknown>(
    name: K,
    ...args: KernelArgs<K>
  ): Promise<R | undefined> {
    return this.root.bus.serial<K, R>(name, ...args);
  }

  // ---- 生命周期 ----

  /** 拆卸本上下文：监听器 → 子 fiber → 服务 → 副作用（逆序） */
  async dispose(): Promise<void> {
    this.root.bus.removeOwner(this.fiber.uid);
    await this.fiber.dispose();
    this.settle();
  }

  /** 内核内部：共享同一 root、但注册归属指定 fiber 的上下文（inject/plugin 激活用） */
  private childContext(fiber: Fiber): Context {
    return new Context(this.root, fiber);
  }

  /**
   * 依赖审计报告。**没有它，inject 就是静默失败**（DSH 的教训：
   * PENDING 是合法状态，插件可以永远不动且不发出任何提示）。
   */
  audit(): AuditReport {
    this.settle();
    const pending: AuditReport["pending"] = [];
    const failed: AuditReport["failed"] = [];
    for (const fiber of this.root.fibers) {
      if (fiber.state === FiberState.PENDING) {
        pending.push({ name: fiber.name, missing: [...fiber.missing] });
      }
      if (fiber.state === FiberState.FAILED) {
        failed.push({ name: fiber.name, error: fiber.error ?? "未知错误" });
      }
    }
    return {
      fibers: this.root.fibers.size,
      pending,
      failed,
      services: [...this.root.services.keys()],
      listeners: this.root.bus.count(),
    };
  }

  /** 重新评估所有依赖门：缺依赖挂起、齐备激活、依赖消失回卷 */
  private settle(): void {
    for (const waiter of [...this.root.waiters]) {
      const owner = waiter.owner;
      if (owner.state === FiberState.DISPOSED) {
        this.root.waiters.delete(waiter);
        continue;
      }
      const missing = waiter.keys.filter((key) => !this.root.services.has(key));
      waiter.missing = missing;

      if (missing.length > 0) {
        if (waiter.active) {
          const active = waiter.active;
          waiter.active = null;
          void active.dispose();
        }
        owner.state = FiberState.PENDING;
        owner.missing = missing;
        owner.error = undefined;
        continue;
      }

      if (waiter.active) {
        // 激活失败不因"依赖仍在"而被复活；失败保持到依赖集合变化为止（避免失败重试环）
        if (waiter.active.state === FiberState.FAILED) {
          owner.state = FiberState.FAILED;
          owner.error = waiter.active.error;
        } else {
          owner.state = FiberState.ACTIVE;
          owner.missing = [];
        }
        continue;
      }

      const active = newFiber(this.root, `${waiter.label} (active)`, owner, true);
      waiter.active = active;
      owner.state = FiberState.ACTIVE;
      owner.missing = [];
      runActivation(
        this.root,
        active,
        () => {
          // 赋值放进闭包：TS 不会因此窄化下面的失败判定
          active.state = FiberState.ACTIVE;
          waiter.activate?.();
        },
        false,
      );
      // 激活失败：把失败态上抛到插件 fiber，让审计报告指向插件名而不是内部子 fiber
      if (active.state === FiberState.FAILED) {
        owner.state = FiberState.FAILED;
        owner.error = active.error;
      }
    }
  }
}

// ---- 内部实现 ----

interface RootState {
  services: Map<string, ServiceEntry>;
  waiters: Set<Waiter>;
  fibers: Set<Fiber>;
  bus: EventBus;
  uid: number;
  onError: (error: unknown, fiberName: string) => void;
}

function newFiber(root: RootState, name: string, parent: Fiber, internal = false): Fiber {
  const fiber = new Fiber(++root.uid, name);
  parent.children.push(fiber);
  // internal fiber 是内核的激活载体（inject / 带 inject 的 plugin），不进审计列表
  if (!internal) root.fibers.add(fiber);
  // 归属清理：监听器按 uid 回收；fiber 从审计列表移除（逆序拆卸时最后执行）
  fiber.effect(() => {
    root.bus.removeOwner(fiber.uid);
    root.fibers.delete(fiber);
  });
  return fiber;
}

/** 把激活回调的返回值（disposer / promise<disposer>）登记到 fiber 上 */
function attachResult(fiber: Fiber, result: void | Disposer | Promise<void | Disposer>): void {
  if (isPromise(result)) {
    fiber.effect(() =>
      result.then((disposer) => (typeof disposer === "function" ? disposer() : undefined)),
    );
    return;
  }
  if (typeof result === "function") fiber.effect(result);
}

/**
 * 执行激活动作。
 * @param rethrow - 同步挂载路径传 true：配置/代码错误当场抛给调用方（装配层需要立刻失败）；
 *                  依赖门控路径传 false：激活由"服务出现"触发，没有调用方可抛，
 *                  故记入审计（audit().failed）+ onError。
 */
function runActivation(root: RootState, fiber: Fiber, apply: () => void, rethrow: boolean): void {
  try {
    apply();
  } catch (error) {
    fiber.state = FiberState.FAILED;
    fiber.error = error instanceof Error ? error.message : String(error);
    root.onError(error, fiber.name);
    if (rethrow) throw error;
  }
}
