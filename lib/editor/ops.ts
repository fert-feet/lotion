// 自研块编辑器编辑操作（纯函数，输入 markdown + 操作 → 新 markdown）。
// 只重写受影响块的源切片，其余原文原样保留（对齐 SiYuan 的事务语义：
// 单块替换、按块插入/删除）。
//
// MVP 语义：
// - replaceBlockText：块文本替换（段落/标题/列表项/引用为行文本；code 为多行）
// - splitBlock：Enter 分块（继承块类型；列表项新建同级项）
// - mergeIntoPrevious：Backspace 合并（文本拼接，类型取前块）
// - deleteBlock：空块退格删除（列表项直接删行；删除后空文档保底空段落）
// - toggleTodo：任务项勾选切换

import { parseEditableBlocks, type EditableBlock } from "./blocks";

/** 结果：新 markdown + 操作后重新解析的块（供组件层定位光标/焦点） */
export interface EditResult {
  markdown: string;
  blocks: EditableBlock[];
}

function rebuild(markdown: string): EditResult {
  return { markdown, blocks: parseEditableBlocks(markdown) };
}

/** 行文本块（段落/标题/列表项/引用）重建源：前缀 + 文本 + 后续行（嵌套/引用多行）；
 *  块锚点 {#id} 追加到末行行尾（阶段 3：AI 块级定位稳定性） */
function rebuildLineBlock(block: EditableBlock, text: string): string {
  const lines = block.source.split("\n");
  const first = lines[0] ?? "";
  let prefix: string;
  if (block.kind === "heading") {
    const level = block.meta.level ?? 1;
    prefix = "#".repeat(level) + " ";
  } else if (block.kind === "bullet") {
    prefix = "- ";
  } else if (block.kind === "numbered") {
    prefix = "1. ";
  } else if (block.kind === "todo") {
    prefix = block.meta.checked ? "- [x] " : "- [ ] ";
  } else if (block.kind === "quote") {
    prefix = "> ";
  } else {
    prefix = "";
  }
  // 保留后续行（嵌套子列表 / 引用后续行）；第一行替换为 prefix + text
  const rebuilt = [prefix + text, ...lines.slice(1)].join("\n");
  if (block.meta.anchor) {
    return rebuilt + " {#" + block.meta.anchor + "}";
  }
  return rebuilt;
}

/** 替换块的文本内容（inline markdown 文本） */
export function replaceBlockText(markdown: string, index: number, text: string): EditResult {
  const blocks = parseEditableBlocks(markdown);
  const block = blocks[index];
  if (!block) return rebuild(markdown);

  let newSource: string;
  if (block.kind === "code") {
    const lang = block.meta.lang ?? "";
    const body = block.meta.anchor ? text + " {#" + block.meta.anchor + "}" : text;
    newSource = "```" + lang + "\n" + body + "\n```";
  } else {
    newSource = rebuildLineBlock(block, text);
  }
  const next = markdown.slice(0, block.start) + newSource + markdown.slice(block.end);
  return rebuild(next);
}

/**
 * Enter 分块：光标处文本一分为二。
 * 当前块保留前段，新块（index+1）为后段，类型继承当前块
 * （heading 继承级别；列表项新建同级项；code 不分块——组件层在 code 块内拦截 Enter）。
 */
export function splitBlock(markdown: string, index: number, textBefore: string, textAfter: string): EditResult {
  const blocks = parseEditableBlocks(markdown);
  const block = blocks[index];
  if (!block || block.kind === "code" || block.kind === "divider" || block.kind === "table") {
    return rebuild(markdown);
  }

  // 当前块更新为前段
  const updated = replaceBlockText(markdown, index, textBefore);
  const updatedBlocks = updated.blocks;
  const after = updatedBlocks[index];

  // 新块插入到 index+1：后段文本按当前类型生成源
  let newSource: string;
  switch (after.kind) {
    case "heading": {
      const level = after.meta.level ?? 1;
      newSource = "#".repeat(level) + " " + textAfter;
      break;
    }
    case "bullet":
      newSource = "- " + textAfter;
      break;
    case "numbered":
      newSource = "1. " + textAfter;
      break;
    case "todo":
      newSource = after.meta.checked ? "- [x] " + textAfter : "- [ ] " + textAfter;
      break;
    case "quote":
      newSource = "> " + textAfter;
      break;
    default:
      newSource = textAfter;
  }

  const insertAt = after.end;
  const next = updated.markdown.slice(0, insertAt) + "\n\n" + newSource + updated.markdown.slice(insertAt);
  return rebuild(next);
}

/** Backspace 合并：当前块文本接到前块文本后（空格分隔），类型取前块 */
export function mergeIntoPrevious(markdown: string, index: number): EditResult {
  const blocks = parseEditableBlocks(markdown);
  const block = blocks[index];
  const prev = blocks[index - 1];
  if (!block || !prev) return rebuild(markdown);
  if (block.kind === "divider" || block.kind === "table" || prev.kind === "code") {
    return rebuild(markdown);
  }

  // 前块更新为拼接文本；当前块删除
  const mergedText = (prev.text ? prev.text + " " : "") + block.text;
  const replaced = replaceBlockText(markdown, index - 1, mergedText);
  const deleted = deleteBlock(replaced.markdown, index);
  return rebuild(deleted.markdown);
}

/** 删除块（空块退格 / 合并用）；删除后若文档为空保底一个空段落 */
export function deleteBlock(markdown: string, index: number): EditResult {
  const blocks = parseEditableBlocks(markdown);
  const block = blocks[index];
  if (!block) return rebuild(markdown);
  if (blocks.length === 1) {
    // 只剩一个块：清空文本而非删除（保持一个空段落）
    return replaceBlockText(markdown, 0, "");
  }
  // 删除范围向前吞掉块间空行（mdast position 不含前导换行），
  // 避免删除后残留 "\n\n\n" 多余空行；块尾之后的空行由后续块自然衔接
  let s = block.start;
  while (s > 0 && markdown[s - 1] === "\n") s--;
  const next = markdown.slice(0, s) + markdown.slice(block.end);
  return rebuild(next);
}

/** 任务项勾选切换 */
export function toggleTodo(markdown: string, index: number): EditResult {
  const blocks = parseEditableBlocks(markdown);
  const block = blocks[index];
  if (!block || block.kind !== "todo") return rebuild(markdown);
  const next = block.meta.checked ? "- [ ] " : "- [x] ";
  const newSource = next + block.source.replace(/^\s*[-*]\s+\[( |x|X)\]\s*/, "");
  const updated = markdown.slice(0, block.start) + newSource + markdown.slice(block.end);
  return rebuild(updated);
}
