// 接缝：uiSlots —— UI 贡献点（Service Definition，客户端侧）。
//
// 三角色：
//   Definition ← 本文件：插槽注册表契约（两种 kind）
//   Provider   ← 客户端内核装配时 provide（src/kernel/client.ts）
//   Consumer   ← 渲染方组件（AppShell 等）按 slot 名取内容；贡献方是各 UI 插件
//
// 只保留两种 kind（对齐 docs/插件化架构.md §0 的"砍掉 4 kind"决定）：
//   single —— 唯一贡献者（重复注册抛错）。用于"详情栏面板""对话框"这类独占位置。
//   list   —— 有序列表（按 order 升序，order 相同按注册顺序）。用于"工具栏按钮""侧边栏条目"。
//
// 泛型 `TComponent` 让本文件不依赖 React（装配方传入自己的组件类型）。
import { Context, provideService, readService } from "@/lib/kernel";

/** 插槽名（约定：`区域.子区域`，如 "details.panel"、"sidebar.actions"） */
export type SlotName = string;

/** 槽位类型 */
export type SlotKind = "single" | "list";

export interface SingleSlotContribution<TComponent> {
  id: string;
  slot: SlotName;
  kind: "single";
  component: TComponent;
}

export interface ListSlotContribution<TComponent> {
  id: string;
  slot: SlotName;
  kind: "list";
  component: TComponent;
  /** 排序权重（越小越靠前；默认 0） */
  order?: number;
}

export type SlotContribution<TComponent> =
  | SingleSlotContribution<TComponent>
  | ListSlotContribution<TComponent>;

export interface UiSlots<TComponent = unknown> {
  /**
   * 注册一个贡献。
   * @throws id 重复、或 single 槽已有贡献者时抛错（就地失败，不让两个插件抢同一位置）
   */
  register(contribution: SlotContribution<TComponent>): void;
  /** 取 single 槽内容（无贡献者返回 undefined） */
  get(slot: SlotName): TComponent | undefined;
  /** 取 list 槽内容（已按 order 排序） */
  list(slot: SlotName): TComponent[];
  /** 全部贡献（审计/调试） */
  entries(): ReadonlyArray<SlotContribution<TComponent>>;
  /** 订阅贡献变化（React useSyncExternalStore 用） */
  subscribe(listener: () => void): () => void;
  /** 贡献版本号：每次 register 自增（快照必须稳定，否则 useSyncExternalStore 会死循环） */
  version(): number;
}

export const UI_SLOTS_SERVICE = "uiSlots";

/** 创建插槽注册表 */
export function createUiSlots<TComponent>(): UiSlots<TComponent> {
  const contributions: SlotContribution<TComponent>[] = [];
  const listeners = new Set<() => void>();
  let revision = 0;

  return {
    register(contribution) {
      const { id, slot, kind } = contribution;
      if (!id || !slot) throw new Error("[uiSlots] 贡献必须带 id 与 slot");
      if (contributions.some((item) => item.id === id)) {
        throw new Error(`[uiSlots] 贡献 id「${id}」重复`);
      }
      if (kind === "single") {
        const existing = contributions.find((item) => item.slot === slot && item.kind === "single");
        if (existing) {
          throw new Error(`[uiSlots] single 槽「${slot}」已有贡献者「${existing.id}」，不能重复注册`);
        }
      }
      contributions.push(contribution);
      revision += 1;
      for (const listener of [...listeners]) listener();
    },
    get(slot) {
      const found = contributions.find((item) => item.slot === slot && item.kind === "single");
      return found?.component;
    },
    list(slot) {
      return contributions
        .filter(
          (item): item is ListSlotContribution<TComponent> =>
            item.slot === slot && item.kind === "list",
        )
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((item) => item.component);
    },
    entries: () => [...contributions],
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => revision,
  };
}

/** 装配插槽注册表 */
export function provideUiSlots<TComponent>(ctx: Context, slots: UiSlots<TComponent>): void {
  if (typeof slots?.register !== "function" || typeof slots?.get !== "function") {
    throw new Error("uiSlots 实现不完整：需要 register() / get() / list()");
  }
  provideService(ctx, UI_SLOTS_SERVICE, slots);
}

/** 读插槽注册表；未装配返回 undefined */
export function findUiSlots<TComponent>(ctx: Context): UiSlots<TComponent> | undefined {
  return readService<UiSlots<TComponent>>(ctx, UI_SLOTS_SERVICE);
}

/** 读插槽注册表；未装配抛错 */
export function requireUiSlots<TComponent>(ctx: Context): UiSlots<TComponent> {
  const slots = findUiSlots<TComponent>(ctx);
  if (!slots) {
    throw new Error(
      `uiSlots 未装配：请确认客户端内核装配时挂载了 ui-slots 提供方（服务 key「${UI_SLOTS_SERVICE}」）`,
    );
  }
  return slots;
}
