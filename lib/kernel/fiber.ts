// Fiber：一次插件挂载的生命周期与它名下的全部可逆副作用。
//
// 状态机（对齐 Cordis fiber 的可用子集）：
//   PENDING（依赖未就绪，合法状态）→ ACTIVE（apply 已执行）→ DISPOSED
//   PENDING / ACTIVE 都可能因依赖消失回到 PENDING（并运行已注册的 disposer）
//
// 拆卸顺序：子 fiber 先于父；同 fiber 内 effect 逆序执行（后注册的先撤，保证依赖关系不倒挂）。

/** fiber 状态 */
export const FiberState = {
  /** 依赖未就绪，等待服务出现（不是错误） */
  PENDING: "pending",
  /** apply 已执行，注册处于生效状态 */
  ACTIVE: "active",
  /** apply 抛错 */
  FAILED: "failed",
  /** 已拆卸（幂等终态） */
  DISPOSED: "disposed",
} as const;

export type FiberState = (typeof FiberState)[keyof typeof FiberState];

/** 资源释放函数；可异步（拆卸时逐个 await） */
export type Disposer = () => void | Promise<void>;

export class Fiber {
  readonly uid: number;
  readonly name: string;
  readonly children: Fiber[] = [];
  state: FiberState = FiberState.PENDING;
  /** 缺少的服务（PENDING 原因，供 auditPending 报告） */
  missing: string[] = [];
  /** 激活失败原因（state = FAILED 时） */
  error?: string;
  /** 本 fiber 名下的可逆副作用（逆序拆卸） */
  private readonly effects: Disposer[] = [];
  private disposed = false;

  constructor(uid: number, name: string) {
    this.uid = uid;
    this.name = name;
  }

  /**
   * 登记一个可逆副作用。
   * 若 fiber 已拆卸：**立即执行 disposer**（而不是留下泄漏的注册），保证"晚到的异步注册"不产生孤儿。
   */
  effect(disposer: Disposer): void {
    if (this.disposed) {
      void disposer();
      return;
    }
    this.effects.push(disposer);
  }

  get effectCount(): number {
    return this.effects.length;
  }

  /** 拆卸：子 fiber → 自身 effects（逆序）；幂等 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const child of [...this.children].reverse()) {
      await child.dispose();
    }
    this.children.length = 0;
    // 逆序拆卸：后注册的副作用先撤
    const queue = [...this.effects].reverse();
    this.effects.length = 0;
    for (const disposer of queue) {
      await disposer();
    }
    this.state = FiberState.DISPOSED;
  }
}
