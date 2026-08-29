// 文档内容适配层（重构阶段 B）：规范存储格式 = BlockNote JSON（无损，保留块 ID）。
// - 服务端（AI 工具）：经 @blocknote/server-util 的 ServerBlockNoteEditor 做
//   JSON↔Markdown 双向转换——旧实现"模块级转换需要 prosemirror Schema、服务端
//   不可用"的死穴已解（server-util 内部用 JSDOM 模拟 document/window）
// - 客户端（编辑器）：JSON 直接解析（toEditorBlocks）；存量 Markdown 由编辑器
//   tryParseMarkdownToBlocks 在挂载后转换（见 app/(main)/_components/editor.tsx）
// 存量兼容（惰性，不强制写回）：
//   - 旧 BlockNote JSON（0.41 时代）：shape 与 0.54 兼容，直接解析加载
//   - Markdown（阶段 1-3 产物）：编辑器挂载时转换；AI 读取 toMarkdown 原样返回；
//     AI 写入（createNote/updateNote/updateBlock）自动转 JSON

import { ServerBlockNoteEditor } from "@blocknote/server-util";
import type { Block } from "@blocknote/core";

/** 编辑器可消费的块结构最小形状（旧 BlockNote JSON 结构；运行时无 BlockNote 依赖） */
export interface EditorBlockLike {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown[];
  children?: EditorBlockLike[];
}

/** 判断内容是否为 BlockNote JSON 数组（Markdown 文本原样返回 false） */
export function isBlockNoteJson(content: string | null | undefined): boolean {
  if (!content) return false;
  const t = content.trimStart();
  return t.startsWith("[") && t.endsWith("]");
}

/**
 * 统一取编辑器 blocks（客户端安全版）：
 * - BlockNote JSON：解析原样返回（解析失败返回 undefined）
 * - Markdown（存量旧数据）：返回 undefined——编辑器挂载后经 tryParseMarkdownToBlocks
 *   填充（见 editor.tsx）
 */
export function toEditorBlocks(content: string | null | undefined): EditorBlockLike[] | undefined {
  if (!content || !isBlockNoteJson(content)) return undefined;
  try {
    return JSON.parse(content) as EditorBlockLike[];
  } catch {
    return undefined;
  }
}

// server-util 单例（JSDOM + prosemirror schema 较重，懒创建复用）
let serverEditor: ServerBlockNoteEditor | null = null;
function getServerEditor(): ServerBlockNoteEditor {
  if (!serverEditor) serverEditor = ServerBlockNoteEditor.create();
  return serverEditor;
}

/**
 * 统一取 Markdown 原文（服务端，异步）：
 * - Markdown 原样返回（存量旧数据）
 * - BlockNote JSON → Markdown（有损转换，仅用于 AI 读取展示；JSON 解析失败原样返回）
 */
export async function toMarkdown(content: string | null | undefined): Promise<string> {
  if (!content) return "";
  if (!isBlockNoteJson(content)) return content;
  try {
    const blocks = JSON.parse(content) as Block[];
    if (!Array.isArray(blocks) || blocks.length === 0) return "";
    return await getServerEditor().blocksToMarkdownLossy(blocks);
  } catch {
    return content;
  }
}

/**
 * 统一取 BlockNote blocks（服务端，异步）：
 * - Markdown → blocks（AI 写入转换，生成真实块 ID）
 * - BlockNote JSON 原样解析
 */
export async function toBlocks(content: string | null | undefined): Promise<Block[]> {
  if (!content || !content.trim()) return [];
  if (isBlockNoteJson(content)) {
    try {
      const blocks = JSON.parse(content) as Block[];
      return Array.isArray(blocks) ? blocks : [];
    } catch {
      return [];
    }
  }
  return getServerEditor().tryParseMarkdownToBlocks(content);
}

/** 从 Markdown 提取首个 "# 一级标题" 作为文档标题（无则返回 null） */
export function extractMarkdownTitle(markdown: string): string | null {
  const m = markdown.match(/^# (.+)$/m);
  return m ? m[1].trim() : null;
}
