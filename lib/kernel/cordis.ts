// Cordis 适配层：Lotion 只从这里接触内核。
//
// 为什么需要它（而不是到处直接 import cordis）：
//   1. **收窄语义差异**：Cordis 有几处与我们此前自研内核不同（见下），适配层把差异集中在一处；
//   2. **将来换实现只改这一个文件**：npm 依赖 ↔ vendor 源码（deepseek-harness/vendor/cordis）随你切换；
//   3. Cordis 运行时**没有** FiberState（它是编译期 const enum）也没有 audit —— 由本文件补齐。
//
// ⚠️ 与自研近似内核的四处语义差异（尖刺单测 test/lib/kernel/cordis-spike.test.ts 已钉住）：
//   1. **激活是异步的**：`ctx.plugin()` 只启动加载（state=LOADING），必须 `await fiber.inertia`
//      —— 用本文件的 `settle()` / `settleAll()`；同步假设会静默拿到"还没生效"的树。
//   2. **FiberState 运行时不存在**：Cordis 用 `export const enum`，编译后被擦除。这里按源码顺序重建。
//   3. **effect 是"立即执行并返回 disposer"**：`ctx.effect(() => { setup(); return () => cleanup() })`，
//      而不是"回调本身就是 disposer"。需要"仅在卸载时执行"时写成 `ctx.effect(() => () => cleanup())`。
//   4. **waterfall 由调用方传最内层 next**：`ctx.waterfall(name, ...args, terminalNext)`。
import { Context, type Fiber } from "@deepseek-ai/cordis";

export {
  Context,
  CordisError,
  DisposableList,
  EventsService,
  Fiber,
  Inject,
  Logger,
  LoggerService,
  RegistryService,
  Service,
  ValidationError,
  symbols,
} from "@deepseek-ai/cordis";

/**
 * Fiber 状态常量。
 * Cordis 用 `export const enum FiberState`（运行时被擦除、不导出），故按 vendor 源码顺序重建：
 * PENDING / LOADING / ACTIVE / FAILED / DISPOSED / UNLOADING → 0..5。
 */
export const FiberState = {
  /** 等待被 inject 声明的服务就绪（合法状态，需要审计才能发现） */
  PENDING: 0,
  /** 插件回调执行中 */
  LOADING: 1,
  /** 已激活 */
  ACTIVE: 2,
  /** 激活失败 */
  FAILED: 3,
  /** 已拆卸 */
  DISPOSED: 4,
  /** 卸载中 */
  UNLOADING: 5,
} as const;

export type FiberState = (typeof FiberState)[keyof typeof FiberState];

/** 状态 → 可读名（审计/日志用） */
export const FIBER_STATE_NAMES: Record<number, string> = {
  [FiberState.PENDING]: "pending",
  [FiberState.LOADING]: "loading",
  [FiberState.ACTIVE]: "active",
  [FiberState.FAILED]: "failed",
  [FiberState.DISPOSED]: "disposed",
  [FiberState.UNLOADING]: "unloading",
};

/** 新建根上下文（Cordis 的根 fiber uid 为 0） */
export function createRootContext(): Context {
  return new Context();
}

/** 等待一个 fiber 的加载/卸载转换结束（Cordis 的激活是异步的） */
export async function settle(fiber: Fiber): Promise<Fiber> {
  let guard = 0;
  while (fiber.inertia && guard++ < 100) await fiber.inertia;
  return fiber;
}

/** 等待当前所有 fiber 转换结束（装配完成后调用；循环两轮以覆盖"激活时又挂插件"的情况） */
export async function settleAll(ctx: Context): Promise<void> {
  for (let round = 0; round < 2; round++) {
    const fibers: Fiber[] = [];
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) fibers.push(fiber);
    }
    await Promise.all(fibers.map((fiber) => settle(fiber)));
  }
}

export interface AuditReport {
  /** 活跃 fiber 数（不含已拆卸） */
  fibers: number;
  /** 未激活（缺依赖）的插件：名字 + 缺失服务 */
  pending: Array<{ name: string; missing: string[] }>;
  /** 激活失败的插件 */
  failed: Array<{ name: string; error: string }>;
  /** 已装配的服务名 */
  services: string[];
}

/**
 * 依赖审计（Cordis 自身没有这个能力）。
 * 没有它，`inject` 门控失败就是**静默**的：插件停在 PENDING（合法状态）永远不干活。
 */
export function audit(ctx: Context): AuditReport {
  const pending: AuditReport["pending"] = [];
  const failed: AuditReport["failed"] = [];
  let fibers = 0;

  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) {
      if (fiber.state === FiberState.DISPOSED) continue;
      fibers++;
      const name = fiber.name;
      if (fiber.state === FiberState.PENDING || fiber.state === FiberState.UNLOADING) {
        // fiber.inject 是公开字段：能报出"缺哪个服务"，而不只是"这个插件没起来"
        const missing = Object.keys(fiber.inject ?? {}).filter((key) => ctx.get(key) === undefined);
        pending.push({ name, missing });
      }
      if (fiber.state === FiberState.FAILED) {
        const error = (fiber as unknown as { _error?: unknown })._error;
        failed.push({ name, error: error instanceof Error ? error.message : String(error ?? "未知错误") });
      }
    }
  }

  // 服务清单来自 reflect 层：**注意 store 的键是 isolate Symbol（ctx[symbols.isolate][name]）**，
  // 所以按名取必须走 Object.getOwnPropertySymbols，读实现记录里的 name。
  const reflect = ctx.reflect as unknown as { store?: Record<symbol, { name?: string }> };
  const store = reflect.store ?? {};
  const services = Object.getOwnPropertySymbols(store)
    .map((key) => store[key]?.name)
    .filter((name): name is string => typeof name === "string");

  return { fibers, pending, failed, services };
}

/** 是否一切就绪（无 PENDING、无 FAILED） */
export function auditOk(report: AuditReport): boolean {
  return report.pending.length === 0 && report.failed.length === 0;
}

/** 审计报告的可读文本（启动日志一次打印） */
export function formatAudit(report: AuditReport): string {
  const lines = [
    `[cordis] 已装配 ${report.fibers} 个 fiber · ${report.services.length} 个服务`,
  ];
  if (report.failed.length > 0) {
    lines.push(`[cordis] ✗ ${report.failed.length} 个插件激活失败：`);
    for (const item of report.failed) lines.push(`    - ${item.name}：${item.error}`);
  }
  if (report.pending.length > 0) {
    lines.push(`[cordis] ⚠ ${report.pending.length} 个插件处于 PENDING（缺少服务，不会工作）：`);
    for (const item of report.pending) {
      lines.push(`    - ${item.name}：等待 ${item.missing.length > 0 ? item.missing.join("、") : "（未知服务）"}`);
    }
  }
  return lines.join("\n");
}
