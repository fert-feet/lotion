// 内核入口：应用与插件只从这里 import（`@/lib/kernel`）。
// 环境无关的纯 TS —— 禁止出现 `node:` / `better-sqlite3` / DOM 专有 API，
// 因为浏览器与服务端两个进程共用同一份内核（由 test/boundary.test.ts 守卫）。
export { Context } from "./context";
export type { AuditReport, MountOptions, Plugin, PluginFunction, PluginObject, RootOptions } from "./context";
export { Fiber, FiberState } from "./fiber";
export type { Disposer } from "./fiber";
export { EventBus } from "./events";
export type {
  EmitListener,
  KernelArgs,
  KernelEventMap,
  KernelEventName,
  SerialListener,
  WaterfallListener,
  WaterfallNext,
} from "./events";
export { auditOk, formatAudit } from "./audit";
