// 文档内容适配层·服务端部分（重构阶段 B，⚠️ 禁止客户端导入）：
// 规范存储格式 = BlockNote JSON（无损，保留块 ID）。经 @blocknote/server-util 的
// ServerBlockNoteEditor 做 JSON↔Markdown 双向转换——旧实现"模块级转换需要 prosemirror
// Schema、服务端不可用"的死穴已解（server-util 内部用 JSDOM 模拟 document/window）。
// 存量兼容（惰性，不强制写回）：
//   - 旧 BlockNote JSON（0.41 时代）：shape 与 0.54 兼容，直接解析加载
//   - Markdown（阶段 1-3 产物）：编辑器挂载时转换；AI 读取 toMarkdown 原样返回；
//     AI 写入（createNote/updateNote/updateBlock）自动转 JSON

import { ServerBlockNoteEditor } from "@blocknote/server-util";
import type { Block } from "@blocknote/core";
import { isBlockNoteJson, normalizeChecklistBlocks } from "./content";
export { extractMarkdownTitle, isBlockNoteJson } from "./content";

// server-util 单例（JSDOM + prosemirror schema 较重，懒创建复用）
let serverEditor: ServerBlockNoteEditor | null = null;
function getServerEditor(): ServerBlockNoteEditor {
  if (!serverEditor) serverEditor = ServerBlockNoteEditor.create();
  return serverEditor;
}

/**
 * 统一取 Markdown 原文（异步）：
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
 * 统一取 BlockNote blocks（异步）：
 * - Markdown → blocks（AI 写入转换，生成真实块 ID）
 * - BlockNote JSON：解析并规范化（迁移旧版 `[ ]` bulletListItem → checkListItem）
 */
export async function toBlocks(content: string | null | undefined): Promise<Block[]> {
  if (!content || !content.trim()) return [];
  if (isBlockNoteJson(content)) {
    try {
      const blocks = JSON.parse(content) as Block[];
      if (!Array.isArray(blocks)) return [];
      return normalizeChecklistBlocks(blocks as unknown as import("./content").EditorBlockLike[]) as Block[];
    } catch {
      return [];
    }
  }
  return getServerEditor().tryParseMarkdownToBlocks(content);
}
