// 客户端内核装配（浏览器侧的组合根）。
//
// 与宿主内核（server/kernel.ts）对称：同一份 lib/kernel + 同一套接缝契约，
// 只是提供方换成浏览器实现：
//   docStore → lib/client/doc-store-rest.ts（REST /api/*，cookie 承载身份）
//   uiSlots  → 插槽注册表（UI 插件贡献面板/按钮）
//
// 装配顺序与宿主一致：注册表类服务先提供，再由插件注册内容。
import type { ReactNode } from "react";
import {
  Context,
  FIBER_STATE_NAMES,
  audit,
  createRootContext,
  formatLoadReport,
  settleAll,
  type Fiber,
  type LoadReport,
  type PluginEntry,
} from "@/lib/kernel";
import { restDocStorePlugin } from "@/lib/client/doc-store-rest";
import { remotePlugin } from "@/lib/client/remote-rest";
import { dynamicClientPlugin } from "@/src/dynamic/client-runner";
import { createUiSlots, provideUiSlots, type UiSlots } from "@/lib/seams/ui-slots";

export interface ClientKernel {
  ctx: Context;
  /** UI 插槽注册表（渲染方与贡献方都从这里走） */
  uiSlots: UiSlots<ReactNode>;
  load: LoadReport;
  /** 装配激活完成信号（Cordis 激活异步） */
  ready: Promise<void>;
  startupText: string;
  dispose: () => Promise<void>;
}

export interface BootClientKernelOptions {
  /** 追加的 UI 插件条目（测试/动态贡献用） */
  extraPlugins?: PluginEntry[];
}

let current: ClientKernel | null = null;

/**
 * 装配客户端内核（幂等）。
 * **同步返回**：Cordis 的激活是异步的，但装配发起是同步的 —— React 侧需要立刻拿到内核对象。
 * 激活在后台完成（`kernel.ready`）；KernelProvider 会等它就绪再渲染子树。
 */
export function bootClientKernel(options: BootClientKernelOptions = {}): ClientKernel {
  if (current) return current;

  const ctx = createRootContext();
  const uiSlots = createUiSlots<ReactNode>();

  const entries: PluginEntry[] = [
    {
      id: "ui-slots",
      plugin: { name: "ui-slots", apply: (c: Context) => provideUiSlots(c, uiSlots) },
    },
    { id: "doc-store-rest", plugin: restDocStorePlugin },
    // remote：客户端→宿主能力的**白名单边界**（枚举式，无动态注册路径）
    { id: "remote", plugin: remotePlugin },
    // 动态插件客户端半边：宿主没启用通道时是空操作（端点 404 → 什么都不做）
    { id: "dynamic-client", plugin: dynamicClientPlugin },
    ...(options.extraPlugins ?? []),
  ];

  // 同步发起挂载（Cordis 的 ctx.plugin 立即登记 fiber），随后 settle
  const mounted: Array<{ id: string; fiber: Fiber }> = [];
  for (const entry of entries) {
    if (entry.disabled) continue;
    const fiber = ctx.plugin(
      entry.plugin as Parameters<Context["plugin"]>[0],
      entry.config,
    ) as unknown as Fiber;
    mounted.push({ id: entry.id, fiber });
  }

  const load: LoadReport = {
    mounted: mounted.map(({ id, fiber }) => ({
      id,
      name: fiber.name,
      state: fiber.state,
      stateName: FIBER_STATE_NAMES[fiber.state] ?? String(fiber.state),
    })),
    skipped: entries.filter((entry) => entry.disabled).map((entry) => entry.id),
    failed: [],
    unknownPatchIds: [],
    fibers: new Map(mounted.map(({ id, fiber }) => [id, fiber])),
    async dispose() {
      for (const { fiber } of [...mounted].reverse()) await fiber.dispose();
      load.mounted = [];
    },
  };

  const kernel: ClientKernel = {
    ctx,
    uiSlots,
    load,
    ready: Promise.resolve(),
    startupText: "",
    async dispose() {
      await load.dispose();
      current = null;
    },
  };

  // settle 完成后回填状态与审计（同步返回时各 fiber 还在 LOADING）
  kernel.ready = settleAll(ctx)
    .then(() => {
      load.mounted = mounted.map(({ id, fiber }) => ({
        id,
        name: fiber.name,
        state: fiber.state,
        stateName: FIBER_STATE_NAMES[fiber.state] ?? String(fiber.state),
      }));
      load.failed = audit(ctx).failed.map((item) => ({ id: item.name, error: item.error }));
      kernel.startupText = formatLoadReport(load);
    })
    .catch((error: unknown) => {
      console.error("[client-kernel] 装配 settle 失败:", error);
    });

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
