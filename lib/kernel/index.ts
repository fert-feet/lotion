// Lotion 内核入口 —— **真实 Cordis**（@deepseek-ai/cordis 4.x）的适配层。
//
// 迁移历史：本目录此前是自研的 Cordis 近似实现（context/fiber/events/audit/loader），
// 现已改用 DeepSeek Harness vendor 的那份 Cordis（vendor/cordis → npm @deepseek-ai/cordis）。
// 本文件是**全仓库唯一**接触内核的地方：业务代码只 import "@/lib/kernel"，
// 将来在 npm 依赖 ↔ vendor 源码之间切换只改 ./cordis.ts。
//
// 语义差异（由 test/lib/kernel/cordis-spike.test.ts 逐条钉住）：
//   1. 激活是**异步**的 → 用 settle()/settleAll()；装配函数 loadPlugins 因此是 async
//   2. FiberState 在 Cordis 运行时被擦除（const enum 不导出）→ 由 ./cordis.ts 按源码顺序重建
//   3. ctx.effect 是"立即执行并返回 disposer"（不是"回调即 disposer"）
//   4. waterfall 由调用方传最内层 next
//   5. **第二个参数就是 config**（旧内核的第二参是 MountOptions{config}）
import type { Plugin } from "@deepseek-ai/cordis";

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

export {
  FIBER_STATE_NAMES,
  FiberState,
  audit,
  auditOk,
  createRootContext,
  effectOnDispose,
  fiberError,
  formatAudit,
  provideService,
  readService,
  settle,
  settleAll,
} from "./cordis";
export type { AuditReport } from "./cordis";

export { applyPatches, assertStableIds, formatLoadReport, loadPlugins } from "./cordis-loader";
export type { LoadReport, MountedEntry, PluginEntry, PluginPatch } from "./cordis-loader";

/** 插件对象形态（带可选 name/inject 与 apply） */
export type PluginObject = Plugin.Object;
/** 插件函数形态 */
export type PluginFunction = Plugin.Function;
/** 插件三种形态：函数 / 带 apply 的对象 / Service 子类 */
export type PluginLike = Plugin.Function | Plugin.Object | Plugin.Constructor;
/** 资源释放函数（可异步） */
export type Disposer = () => void | Promise<void>;
