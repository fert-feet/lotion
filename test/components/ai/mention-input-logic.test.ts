// @vitest-environment jsdom
// @提及输入框纯逻辑单测：
// 1) 键盘意图 —— Shift+Enter 必须换行而不是发送（回归点：多行草稿此前不可用）；
// 2) 序列化 —— 软换行 <br> 与浏览器回车产生的块级包裹要还原成 \n，不能把多行粘成一行。
import { describe, it, expect } from "vitest";
import { parseMentionText, resolveMentionKey, serializeMentionEditor } from "@/src/shell/mention-input-logic";

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

  it("空输入按 ↑ 召回历史；有内容时不召回（那是正常光标移动）", () => {
    expect(resolveMentionKey({ ...base, key: "ArrowUp", empty: true })).toEqual({ kind: "recall" });
    expect(resolveMentionKey({ ...base, key: "ArrowUp", empty: false })).toEqual({ kind: "ignore" });
    // @ 菜单开着时 ↑ 仍然是"高亮上一个候选"
    expect(
      resolveMentionKey({ ...base, key: "ArrowUp", empty: true, mentionOpen: true, itemCount: 2 }),
    ).toEqual({ kind: "highlight", delta: -1 });
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

describe("parseMentionText：编辑重发时的回填", () => {
  it("把 [@标题](id) 拆成文本与提及分段", () => {
    expect(parseMentionText("看下 [@会议记录](doc-1) 再总结")).toEqual([
      { kind: "text", value: "看下 " },
      { kind: "mention", title: "会议记录", id: "doc-1" },
      { kind: "text", value: " 再总结" },
    ]);
  });

  it("多个提及按顺序保留", () => {
    const segments = parseMentionText("[@A](aaa111)[@B](bbb222)");
    expect(segments).toEqual([
      { kind: "mention", title: "A", id: "aaa111" },
      { kind: "mention", title: "B", id: "bbb222" },
    ]);
  });

  it("普通文本原样返回单段", () => {
    expect(parseMentionText("只是普通问题")).toEqual([{ kind: "text", value: "只是普通问题" }]);
    expect(parseMentionText("")).toEqual([]);
  });

  it("id 太短/格式不符时不误判为提及（与序列化正则一致）", () => {
    expect(parseMentionText("[@A](a1)")).toEqual([{ kind: "text", value: "[@A](a1)" }]);
  });

  it("与序列化互为逆运算（回填再提交不会变形）", () => {
    const text = "帮我改 [@周会纪要](doc-9) 的结论";
    const el = document.createElement("div");
    el.innerHTML = "";
    for (const segment of parseMentionText(text)) {
      if (segment.kind === "text") {
        el.appendChild(document.createTextNode(segment.value));
      } else {
        const chip = document.createElement("span");
        chip.dataset.docId = segment.id;
        chip.dataset.docTitle = segment.title;
        chip.textContent = "@" + segment.title;
        el.appendChild(chip);
      }
    }
    expect(serializeMentionEditor(el)).toBe(text);
  });
});
