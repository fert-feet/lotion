"use client";

// 编辑器 ↔ 外部内容（AI 写库 / 切换文档）同步的**纯状态机**。
//
// 回归背景：外部更新到达时若用户正聚焦在编辑器里，旧实现直接 `return` 但**已经把
// lastApplied 推进了** —— 于是这次更新被永久丢弃，失焦后也不会补应用，
// 用户看到 AI 卡片说"已更新"，正文却纹丝不动。
//
// 现在的语义：
// - 未聚焦（或用户没在编辑）：立即应用；
// - 聚焦中：挂起为 pending，并记录"挂起期间用户是否继续编辑"；
// - 失焦：pending 且用户没在挂起后接着改 → 自动应用；改过 → 保留提示让用户决定
//   （绝不静默覆盖用户正在写的内容，也绝不静默丢弃 AI 的更新）。

export interface EditorSyncState {
  /** 已应用到编辑器正文的外部版本 */
  applied: string | null;
  /** 等待应用的外部版本（用户正在编辑时挂起） */
  pending: string | null;
  /** 挂起之后用户是否继续编辑过 */
  editedWhilePending: boolean;
}

export type EditorSyncEvent =
  | { type: "external"; content: string | null | undefined; focused: boolean }
  | { type: "user-edit" }
  | { type: "blur" }
  | { type: "apply-pending" }
  | { type: "dismiss-pending" };

export interface EditorSyncResult {
  state: EditorSyncState;
  /** 需要应用到编辑器正文的内容（null = 不动） */
  apply: string | null;
}

export function createEditorSyncState(initial: string | null = null): EditorSyncState {
  return { applied: initial, pending: null, editedWhilePending: false };
}

export function reduceEditorSync(state: EditorSyncState, event: EditorSyncEvent): EditorSyncResult {
  switch (event.type) {
    case "external": {
      const content = event.content;
      if (!content) return { state, apply: null };
      // 已经是当前版本 / 已挂起同一版本：不动
      if (state.applied === content || state.pending === content) return { state, apply: null };
      if (event.focused) {
        return { state: { ...state, pending: content, editedWhilePending: false }, apply: null };
      }
      return { state: { applied: content, pending: null, editedWhilePending: false }, apply: content };
    }
    case "user-edit":
      if (!state.pending) return { state, apply: null };
      return { state: { ...state, editedWhilePending: true }, apply: null };
    case "blur": {
      if (!state.pending || state.editedWhilePending) return { state, apply: null };
      return {
        state: { applied: state.pending, pending: null, editedWhilePending: false },
        apply: state.pending,
      };
    }
    case "apply-pending": {
      if (!state.pending) return { state, apply: null };
      return {
        state: { applied: state.pending, pending: null, editedWhilePending: false },
        apply: state.pending,
      };
    }
    case "dismiss-pending": {
      if (!state.pending) return { state, apply: null };
      // 记为"已见"：同一个版本不再反复提示（用户自己的编辑会照常保存到库里）
      return { state: { applied: state.pending, pending: null, editedWhilePending: false }, apply: null };
    }
  }
}
