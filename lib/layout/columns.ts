// 三栏 AppShell（sidebar | center | details）的让步链求解器（移植自 DeepSeek Harness
// packages/client/ui-layout/src/client/columns.ts 的设计）。
//
// 链序固定：优先保证中心列 >= CENTER_MIN —— 先压缩 details，仍不够则自动关闭
// details（推导出的 0 宽，不改写宽度偏好，窗口变宽后自动恢复）；sidebar 永不让步，
// 其渲染宽度恒为拖拽偏好（或折叠 rail），余下缺口由中心列兜底。
//
// 输入为布局 store 的纯宽度偏好（0 = 关闭）；closed 的 sidebar 解析为固定宽
// SIDEBAR_COLLAPSED 控制 rail，closed 的 details 解析为 0 宽（保持挂载）。
// SIDEBAR_AUTO_COLLAPSE 断点由 AppShell 消费（决定有效偏好），求解器本身无断点。

/** 一帧解析出的三列宽度；center 仅在最终兜底时可低于 CENTER_MIN。 */
export interface Columns {
  sidebar: number;
  center: number;
  details: number;
}

// 契约冻结的几何常量（与 DSH 一致）。
/** 中心列下限；仅最终兜底允许低于它。 */
export const CENTER_MIN = 640;
/** 侧边栏拖拽下限。 */
export const SIDEBAR_MIN = 264;
/** 侧边栏拖拽上限。 */
export const SIDEBAR_MAX = 420;
/** 用户拖拽前的侧边栏默认宽度。 */
export const SIDEBAR_DEFAULT = 280;
/** 关闭侧边栏时的 rail 宽度：24px 图标列 + 两侧 16px 内边距。 */
export const SIDEBAR_COLLAPSED = 56;
/** 低于该视口宽度时侧边栏自动折叠为 rail（DSH LG 断点）。 */
export const SIDEBAR_AUTO_COLLAPSE = 1024;
/** details 拖拽下限。 */
export const DETAILS_MIN = 300;
/** details 拖拽上限。 */
export const DETAILS_MAX = 520;
/** details 默认宽度（首次打开时）。 */
export const DETAILS_DEFAULT = 360;

/** 把面板宽度夹进契约范围。 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/**
 * 求解三列宽度。纯函数、无滞回：输出只依赖 (viewport, 偏好)，窗口变宽自动恢复。
 * 偏好在此重新夹取（跨 store 边界，调用方可能传过期范围）。
 * @param viewport - 可用帧宽度（px）。
 * @param sidebar - sidebar 宽度偏好（0 = 关闭）。
 * @param details - details 宽度偏好（0 = 关闭）。
 * @returns 解析宽度；details 0 表示视觉关闭（不卸载），关闭的 sidebar 保留紧凑 rail。
 */
export function computeColumns(viewport: number, sidebar: number, details: number): Columns {
  // sidebar 固定在偏好（或 rail）——它永不让步。
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX);
  const d0 = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX);

  // 第 1 步：全部按偏好宽度放下。
  if (s + d0 + CENTER_MIN <= viewport) return { sidebar: s, center: viewport - s - d0, details: d0 };

  // 第 2 步：details 压缩到其下限。
  const d1 = d0 === 0 ? 0 : Math.max(DETAILS_MIN, viewport - s - CENTER_MIN);
  if (s + d1 + CENTER_MIN <= viewport) return { sidebar: s, center: CENTER_MIN, details: d1 };

  // 第 3 步：自动关闭 details（推导值，偏好不动）；中心兜底吸收剩余缺口。
  return { sidebar: s, center: Math.max(0, viewport - s), details: 0 };
}
