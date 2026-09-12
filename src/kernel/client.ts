// 客户端内核装配（浏览器侧的组合根）。
//
// 与宿主内核（server/kernel.ts）对称：同一份 lib/kernel + 同一套接缝契约，
// 只是提供方换成浏览器实现：
//   docStore → lib/client/doc-store-rest.ts（REST /api/*，cookie 承载身份）
//   uiSlots  → 插槽注册表（UI 插件贡献面板/按钮）
//
// 装配顺序与宿主一致：注册表类服务先提供，再由插件注册内容。
import type { ReactNode } from "react";
import { Context, formatLoadReport, loadPlugins, type LoadReport, type PluginEntry } from "@/lib/kernel";
import { restDocStorePlugin } from "@/lib/client/doc-store-rest";
import { remotePlugin } from "@/lib/client/remote-rest";
import { createUiSlots, provideUiSlots, type UiSlots } from "@/lib/seams/ui-slots";

export interface ClientKernel {
  ctx: Context;
  /** UI 插槽注册表（渲染方与贡献方都从这里走） */
  uiSlots: UiSlots<ReactNode>;
  load: LoadReport;
  startupText: string;
  dispose: () => Promise<void>;
}

export interface BootClientKernelOptions {
  /** 追加的 UI 插件条目（测试/动态贡献用） */
  extraPlugins?: PluginEntry[];
}

let current: ClientKernel | null = null;

/** 装配客户端内核（幂等） */
export function bootClientKernel(options: BootClientKernelOptions = {}): ClientKernel {
  if (current) return current;

  const ctx = Context.createRoot({
    onError: (error, fiberName) => {
      console.error(`[client-kernel] 插件「${fiberName}」激活失败:`, error);
    },
  });
  const uiSlots = createUiSlots<ReactNode>();

  const entries: PluginEntry[] = [
    {
      id: "ui-slots",
      plugin: { name: "ui-slots", apply: (c) => provideUiSlots(c, uiSlots) },
    },
    { id: "doc-store-rest", plugin: restDocStorePlugin },
    // remote：客户端→宿主能力的**白名单边界**（枚举式，无动态注册路径）
    { id: "remote", plugin: remotePlugin },
    ...(options.extraPlugins ?? []),
  ];
  const load = loadPlugins(ctx, entries);
  const startupText = formatLoadReport(load);

  const kernel: ClientKernel = {
    ctx,
    uiSlots,
    load,
    startupText,
    async dispose() {
      await load.dispose();
      await ctx.dispose();
      current = null;
    },
  };
  current = kernel;
  return kernel;
}

/** 取客户端内核；未装配即装配（SPA 场景下首个取用者触发） */
export function getClientKernel(): ClientKernel {
  return current ?? bootClientKernel();
}

/** 是否已装配（诊断/测试用） */
export function isClientKernelBooted(): boolean {
  return current !== null;
}

/** 测试用：清空单例 */
export function _resetClientKernelForTest(): void {
  current = null;
}
