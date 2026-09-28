// @vitest-environment jsdom
// 编辑器 ↔ 外部内容同步状态机单测（防复发：AI 的更新被静默吞掉）。
// 旧行为：聚焦时收到外部更新直接 return 但已推进 lastApplied → 更新永久丢失，
// 用户在正文里永远看不到 AI 的改动，卡片却写着"已更新"。
import { describe, it, expect } from "vitest";
import { createEditorSyncState, reduceEditorSync } from "@/src/shell/editor-sync";

const fresh = () => createEditorSyncState("v1");

describe("reduceEditorSync：外部更新到达", () => {
  it("未聚焦时立即应用", () => {
    const { state, apply } = reduceEditorSync(fresh(), { type: "external", content: "v2", focused: false });
    expect(apply).toBe("v2");
    expect(state.applied).toBe("v2");
    expect(state.pending).toBeNull();
  });

  it("聚焦时挂起而不是丢弃（这就是旧 bug 的根因）", () => {
    const { state, apply } = reduceEditorSync(fresh(), { type: "external", content: "v2", focused: true });
    expect(apply).toBeNull();
    expect(state.pending).toBe("v2");
    expect(state.applied).toBe("v1");
  });

  it("同一版本重复到达不重复挂起 / 不重复应用", () => {
    const first = reduceEditorSync(fresh(), { type: "external", content: "v2", focused: true });
    const again = reduceEditorSync(first.state, { type: "external", content: "v2", focused: true });
    expect(again.apply).toBeNull();
    expect(again.state.pending).toBe("v2");

    const applied = reduceEditorSync(fresh(), { type: "external", content: "v1", focused: false });
    expect(applied.apply).toBeNull();
  });

  it("空内容不触发应用（首次挂载 Markdown 惰性转换走另一条路径）", () => {
    expect(reduceEditorSync(fresh(), { type: "external", content: null, focused: false }).apply).toBeNull();
    expect(reduceEditorSync(fresh(), { type: "external", content: "", focused: false }).apply).toBeNull();
  });
});

describe("reduceEditorSync：失焦补应用", () => {
  it("挂起期间用户没动 → 失焦时自动落地（不再永久丢失）", () => {
    const pending = reduceEditorSync(fresh(), { type: "external", content: "v2", focused: true }).state;
    const { state, apply } = reduceEditorSync(pending, { type: "blur" });
    expect(apply).toBe("v2");
    expect(state.pending).toBeNull();
    expect(state.applied).toBe("v2");
  });

  it("挂起期间用户继续编辑 → 失焦也不覆盖，保留提示", () => {
    let state = reduceEditorSync(fresh(), { type: "external", content: "v2", focused: true }).state;
    state = reduceEditorSync(state, { type: "user-edit" }).state;
    expect(state.editedWhilePending).toBe(true);

    const { state: after, apply } = reduceEditorSync(state, { type: "blur" });
    expect(apply).toBeNull();
    expect(after.pending).toBe("v2");
  });

  it("没有挂起内容时失焦是空操作", () => {
    const { state, apply } = reduceEditorSync(fresh(), { type: "blur" });
    expect(apply).toBeNull();
    expect(state).toEqual(fresh());
  });
});

describe("reduceEditorSync：用户显式选择", () => {
  it("点『载入更新』应用挂起版本", () => {
    const pending = reduceEditorSync(fresh(), { type: "external", content: "v2", focused: true }).state;
    const { state, apply } = reduceEditorSync(pending, { type: "apply-pending" });
    expect(apply).toBe("v2");
    expect(state.applied).toBe("v2");
  });

  it("点『忽略』清掉提示且同一版本不再打扰（用户自己的编辑照常保存）", () => {
    const pending = reduceEditorSync(fresh(), { type: "external", content: "v2", focused: true }).state;
    const { state, apply } = reduceEditorSync(pending, { type: "dismiss-pending" });
    expect(apply).toBeNull();
    expect(state.pending).toBeNull();
    expect(reduceEditorSync(state, { type: "external", content: "v2", focused: true }).state.pending).toBeNull();
    // 新的 AI 更新（v3）仍然会提示
    expect(reduceEditorSync(state, { type: "external", content: "v3", focused: true }).state.pending).toBe("v3");
  });

  it("无挂起内容时两个动作都是空操作", () => {
    expect(reduceEditorSync(fresh(), { type: "apply-pending" }).apply).toBeNull();
    expect(reduceEditorSync(fresh(), { type: "dismiss-pending" }).state).toEqual(fresh());
    expect(reduceEditorSync(fresh(), { type: "user-edit" }).state).toEqual(fresh());
  });
});
