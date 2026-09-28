// @vitest-environment jsdom
// @提及输入框纯逻辑单测：
// 1) 键盘意图 —— Shift+Enter 必须换行而不是发送（回归点：多行草稿此前不可用）；
// 2) 序列化 —— 软换行 <br> 与浏览器回车产生的块级包裹要还原成 \n，不能把多行粘成一行。
import { describe, it, expect } from "vitest";
import { resolveMentionKey, serializeMentionEditor } from "@/src/shell/mention-input-logic";

const base = { shiftKey: false, isComposing: false, mentionOpen: false, itemCount: 0 };

describe("resolveMentionKey：键盘意图", () => {
  it("Enter 发送、Shift+Enter 换行", () => {
    expect(resolveMentionKey({ ...base, key: "Enter" })).toEqual({ kind: "submit" });
    expect(resolveMentionKey({ ...base, key: "Enter", shiftKey: true })).toEqual({ kind: "ignore" });
  });

  it("IME 组词中一律不拦截（否则中文输入会被当成提交）", () => {
    expect(resolveMentionKey({ ...base, key: "Enter", isComposing: true })).toEqual({ kind: "ignore" });
    expect(
      resolveMentionKey({ ...base, key: "ArrowDown", isComposing: true, mentionOpen: true, itemCount: 3 }),
    ).toEqual({ kind: "ignore" });
  });

  it("@ 菜单开着且有候选时：↑↓ 高亮、Enter 选中而不是发送", () => {
    const open = { ...base, mentionOpen: true, itemCount: 3 };
    expect(resolveMentionKey({ ...open, key: "ArrowDown" })).toEqual({ kind: "highlight", delta: 1 });
    expect(resolveMentionKey({ ...open, key: "ArrowUp" })).toEqual({ kind: "highlight", delta: -1 });
    expect(resolveMentionKey({ ...open, key: "Enter" })).toEqual({ kind: "select" });
  });

  it("菜单开着但没有候选（无匹配文档）时 Enter 仍然发送", () => {
    expect(resolveMentionKey({ ...base, mentionOpen: true, itemCount: 0, key: "Enter" })).toEqual({
      kind: "submit",
    });
  });

  it("Esc：菜单开着先关菜单，否则交还面板（停止生成）", () => {
    expect(resolveMentionKey({ ...base, mentionOpen: true, key: "Escape" })).toEqual({ kind: "close" });
    expect(resolveMentionKey({ ...base, key: "Escape" })).toEqual({ kind: "escape" });
  });

  it("其他按键不拦（正常输入）", () => {
    expect(resolveMentionKey({ ...base, key: "a" })).toEqual({ kind: "ignore" });
  });
});

/** 造一个 contentEditable 根节点（不挂载 React，直接测 DOM 序列化） */
function editor(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("serializeMentionEditor", () => {
  it("纯文本原样输出", () => {
    expect(serializeMentionEditor(editor("你好 world"))).toBe("你好 world");
  });

  it("文档胶囊序列化为 [@标题](id)", () => {
    const el = editor('<span data-doc-id="d1" data-doc-title="会议记录"><span>@会议记录</span></span>');
    expect(serializeMentionEditor(el)).toBe("[@会议记录](d1)");
  });

  it("<br> 软换行 → \\n（Shift+Enter 的草稿不能丢换行）", () => {
    expect(serializeMentionEditor(editor("第一行<br>第二行"))).toBe("第一行\n第二行");
  });

  it("浏览器回车产生的 DIV 包裹 → 块间 \\n，且不产生前导换行", () => {
    expect(serializeMentionEditor(editor("<div>第一行</div><div>第二行</div>"))).toBe(
      "第一行\n第二行",
    );
  });

  it("胶囊 + 多行混排", () => {
    const el = editor(
      '看下 <span data-doc-id="d1" data-doc-title="A"><span>@A</span></span><br>再总结一下',
    );
    expect(serializeMentionEditor(el)).toBe("看下 [@A](d1)\n再总结一下");
  });

  it("空编辑器返回空串", () => {
    expect(serializeMentionEditor(editor(""))).toBe("");
    expect(serializeMentionEditor(null)).toBe("");
  });
});
