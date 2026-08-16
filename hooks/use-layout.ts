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
  /** 视口是否低于自动折叠断点（AppShell 镜像） */
  narrow: boolean;
  /** 窄屏下手动重新展开的覆盖位（不改写宽度偏好） */
  narrowExpanded: boolean;
  setSidebar: (px: number) => void;
  setDetails: (px: number) => void;
  toggleSidebar: () => void;
  toggleDetails: () => void;
  openDetails: () => void;
  closeDetails: () => void;
  setNarrow: (narrow: boolean) => void;
}

export const useLayout = create<LayoutState>((set) => ({
  sidebar: SIDEBAR_DEFAULT,
  details: 0,
  narrow: false,
  narrowExpanded: false,
  setSidebar: (px) => set({ sidebar: clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) }),
  setDetails: (px) => set({ details: clampWidth(px, DETAILS_MIN, DETAILS_MAX) }),
  // 窄屏 toggle 只翻转覆盖位：宽度偏好原样保留，变宽后恢复挤压前布局。
  toggleSidebar: () =>
    set((s) => (s.narrow ? { narrowExpanded: !s.narrowExpanded } : { sidebar: s.sidebar === 0 ? SIDEBAR_DEFAULT : 0 })),
  toggleDetails: () => set((s) => ({ details: s.details === 0 ? DETAILS_DEFAULT : 0 })),
  openDetails: () => set((s) => ({ details: s.details === 0 ? DETAILS_DEFAULT : s.details })),
  closeDetails: () => set({ details: 0 }),
  // 跨越断点任一方向都丢弃覆盖位：窄屏默认自动折叠，宽屏回到偏好。
  setNarrow: (narrow) => set((s) => (s.narrow === narrow ? s : { narrow, narrowExpanded: false })),
}));
