"use client";

// 三栏布局 store（移植自 DSH packages/client/ui-layout/src/client/stores.ts 语义）：
// 面板几何以 px 宽度偏好存储（0 = 关闭）。关闭面板会遗忘其拖拽宽度 ——
// 重新打开恢复契约默认值。拖拽写入夹进契约范围，绝不跨越开/关分界线；
// 开/关转换显式写 0 / 默认值。低于自动折叠断点时（AppShell 喂 setNarrow），
// sidebar 的 toggle 翻转 narrowExpanded 覆盖位而非偏好，窗口变宽后恢复原布局。
import { create } from "zustand";
import { clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from "@/lib/layout/columns";

export interface LayoutState {
  /** sidebar 宽度偏好（px；0 = 关闭，渲染为 rail） */
  sidebar: number;
  /** details 宽度偏好（px；0 = 关闭，渲染为 0 宽但保持挂载） */
  details: number;
  /**
   * details（AI 助手）的呈现模式：
   * - docked：占一列，挤压正文（传统三栏）
   * - overlay：浮在正文之上，不挤压（遮罩点击关闭）
   * - fullscreen：铺满正文区（读/聊两种模式切换，不靠窗口宽度被迫决定）
   * 此前只有“列宽”一个维度，窗口变窄时让步链把列压成 0 再隐式改浮层——
   * 同一功能三套行为，用户无法预期。
   */
  detailsMode: DetailsMode;
  /** 视口是否低于自动折叠断点（AppShell 镜像） */
  narrow: boolean;
  /** 窄屏下手动重新展开的覆盖位（不改写宽度偏好） */
  narrowExpanded: boolean;
  setSidebar: (px: number) => void;
  setDetails: (px: number) => void;
  setDetailsMode: (mode: DetailsMode) => void;
  /** 停靠 → 浮层 → 全屏 → 停靠（⌘⇧J 与面板内切换器共用） */
  cycleDetailsMode: () => void;
  toggleSidebar: () => void;
  toggleDetails: () => void;
  openDetails: () => void;
  closeDetails: () => void;
  setNarrow: (narrow: boolean) => void;
}

export const DETAILS_MODES = ["docked", "overlay", "fullscreen"] as const;
export type DetailsMode = (typeof DETAILS_MODES)[number];

export const useLayout = create<LayoutState>((set) => ({
  sidebar: SIDEBAR_DEFAULT,
  details: 0,
  detailsMode: "docked",
  narrow: false,
  narrowExpanded: false,
  setSidebar: (px) => set({ sidebar: clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) }),
  setDetails: (px) => set({ details: clampWidth(px, DETAILS_MIN, DETAILS_MAX) }),
  setDetailsMode: (mode) => set({ detailsMode: mode }),
  cycleDetailsMode: () =>
    set((s) => {
      // 不用非空断言：类型上数组下标可能越界，这里显式兜底回 docked
      const next = DETAILS_MODES[(DETAILS_MODES.indexOf(s.detailsMode) + 1) % DETAILS_MODES.length];
      return { detailsMode: next ?? "docked" };
    }),
  // 窄屏 toggle 只翻转覆盖位：宽度偏好原样保留，变宽后恢复挤压前布局。
  toggleSidebar: () =>
    set((s) => {
      // 窄屏只翻转覆盖位（偏好保持不变），宽屏才真正开关
      if (s.narrow) return { narrowExpanded: !s.narrowExpanded };
      return { sidebar: s.sidebar === 0 ? SIDEBAR_DEFAULT : 0 };
    }),
  toggleDetails: () => set((s) => ({ details: s.details === 0 ? DETAILS_DEFAULT : 0 })),
  openDetails: () => set((s) => ({ details: s.details === 0 ? DETAILS_DEFAULT : s.details })),
  closeDetails: () => set({ details: 0 }),
  // 跨越断点任一方向都丢弃覆盖位：窄屏默认自动折叠，宽屏回到偏好。
  setNarrow: (narrow) => set((s) => (s.narrow === narrow ? s : { narrow, narrowExpanded: false })),
}));
