// 自研块编辑器内核（阶段 2a，对齐 SiYuan 块模型、适配 Markdown 存储）：
// 把 Markdown 解析为"可编辑块"序列——每个块携带类型、源偏移与原文，
// 编辑操作（lib/editor/ops.ts）只重写受影响块的源切片，其余原文原样保留。
//
// 块模型（平铺）：mdast 顶层块一一映射；列表内的每个 listItem 独立成块
// （嵌套子列表归属该 item 的源切片，编辑时整体替换保留）。
// 空文档保底一个空段落块。

import { parseGfm } from "@/components/markdown/parse";
import { extractAnchor } from "./anchors";
import type { RootContent } from "mdast";

export type BlockKind =
  | "paragraph"
  | "heading"
  | "bullet"
  | "numbered"
  | "todo"
  | "quote"
  | "code"
  | "divider"
  | "table";

export interface EditableBlock {
  /** 顶层索引（重新解析后可能变化，渲染 key 应使用 start 偏移） */
  index: number;
  kind: BlockKind;
  /** mdast 节点类型 */
  mdType: string;
  /** 源切片 [start, end)（含嵌套子列表/代码围栏全文） */
  start: number;
  end: number;
  /** 该块 markdown 原文（编辑替换的基础） */
  source: string;
  /** 纯文本内容：heading/paragraph/列表项/引用为行文本；code 为多行代码 */
  text: string;
  /** 类型元数据 */
  meta: {
    level?: number;
    checked?: boolean;
    ordered?: boolean;
    lang?: string;
    /** 块锚点 {#id}（阶段 3：AI 块级定位） */
    anchor?: string;
  };
}

/** 空文档保底段落 */
function emptyParagraph(): EditableBlock {
  return {
    index: 0,
    kind: "paragraph",
    mdType: "paragraph",
    start: 0,
    end: 0,
    source: "",
    text: "",
    meta: {},
  };
}

/** mdast 节点源切片（无 position 时返回空） */
function sourceOf(node: RootContent, md: string): string {
  const p = node.position;
  if (!p) return "";
  return md.slice(p.start.offset, p.end.offset);
}

/** inline 节点 → 纯文本（样式标记剥离） */
function inlineText(nodes: readonly RootContent[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") {
      out += n.value;
    } else if (n.type === "break") {
      out += "\n";
    } else if ("children" in n && Array.isArray(n.children)) {
      out += inlineText(n.children as readonly RootContent[]);
    }
  }
  return out;
}

/** 行文本 + 行尾锚点提取：返回 { text, anchor } */
function withAnchor(line: string): { text: string; anchor?: string } {
  const { id, text } = extractAnchor(line);
  return id ? { text, anchor: id } : { text };
}

/** 多行文本末尾行提取锚点（quote 的锚点约定在最后一行） */
function withAnchorLastLine(multiline: string): { text: string; anchor?: string } {
  const idx = multiline.lastIndexOf("\n");
  if (idx === -1) return withAnchor(multiline);
  const head = multiline.slice(0, idx + 1);
  const { id, text } = extractAnchor(multiline.slice(idx + 1));
  return id ? { text: head + text, anchor: id } : { text: multiline };
}

/** 引用块文本：去掉每行 "> " 前缀 */
function quoteText(source: string): string {
  return source
    .split("\n")
    .map((l) => l.replace(/^\s*>\s?/, ""))
    .join("\n");
}

/** 列表项文本：去掉 "- "/"1. "/"[x] " 前缀后的行文本（todo 正则优先） */
function listItemText(source: string): string {
  const firstLine = source.split("\n", 1)[0] ?? "";
  return firstLine
    .replace(/^\s*[-*]\s+\[( |x|X)\]\s*/, "")
    .replace(/^\s*-\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .trim();
}

/** 顶层块 → 可编辑块（列表展开为 item 序列） */
function pushBlocks(node: RootContent, md: string, out: EditableBlock[]): void {
  const source = sourceOf(node, md);
  const base: Omit<EditableBlock, "kind" | "mdType" | "text" | "meta"> = {
    index: 0,
    start: node.position?.start.offset ?? 0,
    end: node.position?.end.offset ?? 0,
    source,
  };

  switch (node.type) {
    case "heading": {
      const level = node.depth;
      const { text, anchor } = withAnchor(inlineText(node.children as readonly RootContent[]));
      out.push({
        ...base,
        kind: "heading",
        mdType: "heading",
        text,
        meta: { level, anchor },
      });
      return;
    }
    case "paragraph": {
      const { text, anchor } = withAnchor(inlineText(node.children as readonly RootContent[]));
      out.push({
        ...base,
        kind: "paragraph",
        mdType: "paragraph",
        text,
        meta: { anchor },
      });
      return;
    }
    case "list": {
      // 每个 listItem 独立成块（含嵌套子列表的源切片）
      for (const item of node.children) {
        const itemSource = sourceOf(item, md);
        const itemBase = {
          index: 0,
          start: item.position?.start.offset ?? 0,
          end: item.position?.end.offset ?? 0,
          source: itemSource,
        };
        const checked = typeof item.checked === "boolean" ? item.checked : undefined;
        const isTodo = itemSource.match(/^\s*[-*]\s+\[( |x|X)\]\s/) !== null;
        const kind: BlockKind = isTodo ? "todo" : node.ordered ? "numbered" : "bullet";
        const { text, anchor } = withAnchor(listItemText(itemSource));
        out.push({
          ...itemBase,
          kind,
          mdType: "listItem",
          text,
          meta: { ordered: node.ordered === true, checked: isTodo ? checked : undefined, anchor },
        });
      }
      return;
    }
    case "blockquote": {
      const { text, anchor } = withAnchorLastLine(quoteText(source));
      out.push({
        ...base,
        kind: "quote",
        mdType: "blockquote",
        text,
        meta: { anchor },
      });
      return;
    }
    case "code": {
      const { text, anchor } = withAnchorLastLine(node.value ?? "");
      out.push({
        ...base,
        kind: "code",
        mdType: "code",
        text,
        meta: { lang: node.lang ?? undefined, anchor },
      });
      return;
    }
    case "thematicBreak": {
      out.push({
        ...base,
        kind: "divider",
        mdType: "thematicBreak",
        text: "",
        meta: {},
      });
      return;
    }
    case "table": {
      out.push({
        ...base,
        kind: "table",
        mdType: "table",
        text: "",
        meta: {},
      });
      return;
    }
    default:
      // 其他顶层块（html/definition 等）渲染为空段落，保持编辑器可编辑
      out.push({
        ...base,
        kind: "paragraph",
        mdType: node.type,
        text: inlineText("children" in node && Array.isArray(node.children) ? (node.children as readonly RootContent[]) : []),
        meta: {},
      });
  }
}

/**
 * 解析 Markdown 为可编辑块序列（编辑操作基于此模型）。
 * @param markdown - 文档 Markdown 原文。
 * @returns 平铺的可编辑块；空文档返回一个空段落。
 */
export function parseEditableBlocks(markdown: string): EditableBlock[] {
  const root = parseGfm(markdown);
  const out: EditableBlock[] = [];
  for (const node of root.children) {
    pushBlocks(node, markdown, out);
  }
  if (out.length === 0) {
    out.push(emptyParagraph());
  }
  out.forEach((b, i) => (b.index = i));
  return out;
}
