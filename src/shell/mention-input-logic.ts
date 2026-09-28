"use client";

// @提及输入框的**纯逻辑**（从 mention-input.tsx 的 DOM 事件处理里抽出来）：
// - 键盘意图判定：Enter 发送 / Shift+Enter 换行 / Esc 关菜单或交还面板 / ↑↓ 高亮 / Enter 选中
// - 内容序列化：胶囊 → `[@标题](id)`，<br> 与块级包裹 → `\n`
//
// 抽出来的理由与 turn-reducer 相同：Shift+Enter 曾经被当成发送（多行草稿不可用），
// 而这条规则埋在 contentEditable 的 onKeyDown 闭包里没有任何测试能钉住它。

export type MentionKeyAction =
  | { kind: "ignore" }
  | { kind: "highlight"; delta: 1 | -1 }
  | { kind: "select" }
  | { kind: "close" }
  | { kind: "escape" }
  | { kind: "submit" };

export interface MentionKeyInput {
  key: string;
  shiftKey: boolean;
  /** IME 组词中：一律不拦截 */
  isComposing: boolean;
  mentionOpen: boolean;
  /** 当前 @ 候选条数（0 时 Enter 应该发送而不是"选中"） */
  itemCount: number;
}

/** 键盘意图（纯函数：可单测，不碰 DOM） */
export function resolveMentionKey(input: MentionKeyInput): MentionKeyAction {
  if (input.isComposing) return { kind: "ignore" };

  if (input.mentionOpen && input.itemCount > 0) {
    if (input.key === "ArrowDown") return { kind: "highlight", delta: 1 };
    if (input.key === "ArrowUp") return { kind: "highlight", delta: -1 };
    if (input.key === "Enter") return { kind: "select" };
  }

  if (input.key === "Escape") {
    return input.mentionOpen ? { kind: "close" } : { kind: "escape" };
  }

  if (input.key === "Enter") {
    // Shift+Enter = 软换行（多行草稿）；不 preventDefault，交给浏览器插入 <br>
    return input.shiftKey ? { kind: "ignore" } : { kind: "submit" };
  }

  return { kind: "ignore" };
}

/**
 * 把 contentEditable 根节点序列化为提交文本：
 * 文档胶囊 → `[@标题](id)`；<br> → `\n`；浏览器回车产生的 DIV/P 包裹 → 块间 `\n`。
 */
export function serializeMentionEditor(root: HTMLElement | null): string {
  if (!root) return "";
  let out = "";
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.docId) {
      out += `[@${node.dataset.docTitle}](${node.dataset.docId})`;
      return;
    }
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    const isBlock = node.tagName === "DIV" || node.tagName === "P";
    if (isBlock && out !== "" && !out.endsWith("\n")) out += "\n";
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  for (const child of Array.from(root.childNodes)) visit(child);
  return out;
}
