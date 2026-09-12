// React 绑定：把客户端内核接进组件树。
//
//   <KernelProvider>          → 树内组件通过 context 拿到内核
//   useDocStore()             → UI 子集 docStore（REST 实现），组件不再直接 import @/lib/db
//   useUiSlots()              → 插槽注册表（渲染方取内容、老插件贡献内容）
//
// 设计取舍：内核是**进程级单例**（与宿主内核对称），Provider 只负责把它交给 React，
// 因此测试里可以在 Provider 外层替换内核（extraPlugins），不需要重新发明 DI。
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { Context as KernelContext } from "@/lib/kernel";
import { requireUiSlots, type UiSlots } from "@/lib/seams/ui-slots";
import { requireUiDocStore, type Actor, type UiDocStore } from "@/lib/seams/doc-store";
import { useUser } from "@/hooks/use-user";
import { bootClientKernel, getClientKernel, type ClientKernel, type BootClientKernelOptions } from "./client";

const ClientKernelContext = createContext<ClientKernel | null>(null);

export function KernelProvider({
  children,
  kernel,
  options,
}: {
  children: ReactNode;
  /** 显式注入内核（测试用）；省略则用/装配进程级单例 */
  kernel?: ClientKernel;
  options?: BootClientKernelOptions;
}) {
  const value = useMemo(
    () => kernel ?? (options ? bootClientKernel(options) : getClientKernel()),
    [kernel, options],
  );
  return <ClientKernelContext.Provider value={value}>{children}</ClientKernelContext.Provider>;
}

/** 取内核上下文（未包 Provider 时回退进程级单例，便于渐进迁移） */
export function useClientKernel(): ClientKernel {
  return useContext(ClientKernelContext) ?? getClientKernel();
}

/** 取内核 Context（需要 ctx.get/inject 等底层能力时用） */
export function useKernelContext(): KernelContext {
  return useClientKernel().ctx;
}

/** 取任意服务；未装配抛错（必需依赖） */
export function useService<T>(key: string): T {
  const ctx = useKernelContext();
  const value = ctx.get<T>(key);
  if (value === undefined) {
    throw new Error(`服务「${key}」未装配：请确认客户端内核的组合清单里挂载了对应提供方`);
  }
  return value;
}

/**
 * 取当前操作主体（Actor）。
 * 浏览器侧身份由会话 cookie 决定，REST 实现会忽略 userId —— 提供本钩子只是为了让
 * 组件调用契约时写法与宿主侧一致（`docStore.remove(actor, id)`），而不是到处拼 userId。
 */
export function useActor(): Actor {
  const { user } = useUser();
  return useMemo(() => ({ userId: user?.id ?? "" }), [user?.id]);
}

/** 取 docStore（UI 子集） */
export function useDocStore(): UiDocStore {
  return requireUiDocStore(useKernelContext());
}

/** 取 UI 插槽注册表 */
export function useUiSlots(): UiSlots<ReactNode> {
  return requireUiSlots<ReactNode>(useKernelContext());
}

/**
 * 取 single 槽内容（无贡献者返回 undefined）。
 * 订阅注册表的版本号：插件在运行期补贡献时能触发重渲染。
 */
export function useSlot(slot: string): ReactNode | undefined {
  const slots = useUiSlots();
  // 订阅版本号：插件运行期补贡献时触发重渲染（读取本身很便宜，直接读、不必 memo）
  useSyncExternalStore(slots.subscribe, slots.version);
  return slots.get(slot);
}

/** 取 list 槽内容（已按 order 排序） */
export function useSlotList(slot: string): ReactNode[] {
  const slots = useUiSlots();
  useSyncExternalStore(slots.subscribe, slots.version);
  return slots.list(slot);
}
