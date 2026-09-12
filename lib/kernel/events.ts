// 内核事件表：四种分发模式（对齐 DSH docs/cordis-primer.zh.md:19-27）。
//
// 领域模块通过**声明合并**增补事件（不需要改内核）：
//
//   declare module "@/lib/kernel/events" {
//     interface KernelEventMap {
//       "doc/created": [id: string];
//     }
//   }
//
// 分发模式是事件公开约定的一部分：观察用 emit、环绕中间件用 waterfall、
// 并行扇出用 parallel、按序执行且有返回值用 serial。

/** 事件表：内核自带框架级事件，领域模块用声明合并继续增补 */
export interface KernelEventMap {
  /** 服务注册完成（审计/可观测性用；携带服务 key） */
  "kernel/service-added": [key: string];
  /** 服务随提供方拆卸而移除 */
  "kernel/service-removed": [key: string];
}

/** 事件名（领域模块未增补时仍可用内核自带的 `kernel/*` 事件） */
export type KernelEventName = keyof KernelEventMap & string;

/** 某事件的参数元组 */
export type KernelArgs<K extends KernelEventName> = KernelEventMap[K];

/** emit / parallel 监听器：只观察，无返回值 */
export type EmitListener<K extends KernelEventName> = (...args: KernelArgs<K>) => void;

/** serial 监听器：按注册顺序串行执行，返回值透出 */
export type SerialListener<K extends KernelEventName, R = unknown> = (
  ...args: KernelArgs<K>
) => R;

/**
 * waterfall 的 next：调用它委托给下游监听器，下游返回值经此返回当前层。
 * 不调用 next 直接返回即**短路**（单决策事件的设计意图）。
 */
export type WaterfallNext<K extends KernelEventName> = (...args: KernelArgs<K>) => unknown;

/** waterfall 监听器：环绕中间件，接收原始参数 + next */
export type WaterfallListener<K extends KernelEventName, R = unknown> = (
  ...args: [...KernelArgs<K>, next: WaterfallNext<K>]
) => R;

/** 事件总线内部条目 */
interface ListenerEntry {
  /** 归属 fiber 的 uid（拆卸时按 owner 批量移除） */
  owner: number;
  fn: (...args: never[]) => unknown;
}

/**
 * 事件总线：按注册顺序保存监听器，四种模式分别分发。
 * 监听器归属其注册时的 fiber —— fiber 卸载即自动移除（可逆副作用）。
 */
export class EventBus {
  private readonly listeners = new Map<string, ListenerEntry[]>();

  /** 注册监听器，返回移除函数 */
  add(owner: number, name: string, fn: (...args: never[]) => unknown): () => void {
    const list = this.listeners.get(name) ?? [];
    const entry: ListenerEntry = { owner, fn };
    list.push(entry);
    this.listeners.set(name, list);
    return () => {
      const current = this.listeners.get(name);
      if (!current) return;
      const index = current.indexOf(entry);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.listeners.delete(name);
    };
  }

  /** 移除某 fiber 的全部监听器（fiber 拆卸时调用） */
  removeOwner(owner: number): void {
    for (const [name, list] of this.listeners) {
      const kept = list.filter((entry) => entry.owner !== owner);
      if (kept.length === 0) this.listeners.delete(name);
      else this.listeners.set(name, kept);
    }
  }

  /** 监听器数量（审计/测试用） */
  count(name?: string): number {
    if (name !== undefined) return this.listeners.get(name)?.length ?? 0;
    let total = 0;
    for (const list of this.listeners.values()) total += list.length;
    return total;
  }

  private snapshot(name: string): ListenerEntry[] {
    return [...(this.listeners.get(name) ?? [])];
  }

  /** emit：监听器按注册顺序观察，同步、无返回值 */
  emit<K extends KernelEventName>(name: K, ...args: KernelArgs<K>): void {
    for (const entry of this.snapshot(name)) {
      (entry.fn as (...a: KernelArgs<K>) => void)(...args);
    }
  }

  /**
   * waterfall：环绕中间件，同步。
   * 监听器必须调用 next() 才委托下去；不调用即短路。连续两次 next() 抛错（防重复委托）。
   */
  waterfall<K extends KernelEventName, R = unknown>(name: K, ...args: KernelArgs<K>): R {
    const chain = this.snapshot(name);
    let index = -1;
    const dispatch = (position: number, current: KernelArgs<K>): R => {
      if (position <= index) throw new Error(`waterfall "${name}": next() 被重复调用`);
      index = position;
      const entry = chain[position];
      if (!entry) return undefined as R;
      const next: WaterfallNext<K> = (...nextArgs) =>
        (nextArgs as unknown[]).length === 0 ? dispatch(position + 1, current) : dispatch(position + 1, nextArgs);
      return (entry.fn as unknown as WaterfallListener<K, R>)(...current, next);
    };
    return dispatch(0, args);
  }

  /** parallel：所有监听器并行观察，await 全部完成 */
  async parallel<K extends KernelEventName>(name: K, ...args: KernelArgs<K>): Promise<void> {
    await Promise.all(
      this.snapshot(name).map((entry) =>
        Promise.resolve((entry.fn as (...a: KernelArgs<K>) => unknown)(...args)),
      ),
    );
  }

  /** serial：监听器按注册顺序串行，最后一个有返回值的监听器结果透出 */
  async serial<K extends KernelEventName, R = unknown>(
    name: K,
    ...args: KernelArgs<K>
  ): Promise<R | undefined> {
    let result: R | undefined;
    for (const entry of this.snapshot(name)) {
      result = (await (entry.fn as (...a: KernelArgs<K>) => R | Promise<R>)(...args)) as R;
    }
    return result;
  }
}
