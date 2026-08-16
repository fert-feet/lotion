// 文档内容适配层：documents.content 的存储语义从 BlockNote JSON 迁移为 Markdown。
// 阶段 1（过渡）：旧数据仍是 BlockNote JSON，读取时按需转换；新写入一律 Markdown。
// - 服务端（AI 工具 / 大纲 / 全文搜索）经 toMarkdown 拿 Markdown 原文（AI 无损读写，
//   旧数据经自研 blocksToMarkdown 转换——模块级转换器需要 prosemirror Schema，服务端不可用）
// - 客户端（编辑器）经 toEditorBlocks 拿 BlockNote blocks：旧 JSON 原样；
//   Markdown 由编辑器实例方法 tryParseMarkdownToBlocks 处理（见 editor.tsx）
// 迁移策略：惰性双格式兼容，不强制写回；阶段 2 自研编辑器落地后统一迁移存量数据。

import type { PartialBlock } from "@blocknote/core";
import { blocksToMarkdown } from "./blocks-to-markdown";

/** 判断内容是否为 BlockNote JSON 数组（旧格式；Markdown 文本原样返回 false） */
export function isBlockNoteJson(content: string | null | undefined): boolean {
  if (!content) return false;
  const t = content.trimStart();
  return t.startsWith("[") && t.endsWith("]");
}

/**
 * 统一取 Markdown 原文：BlockNote JSON（旧数据）→ Markdown；Markdown 原样返回。
 * JSON 解析失败（坏数据）时原样返回，不抛错。
 */
export function toMarkdown(content: string | null | undefined): string {
  if (!content) return "";
  if (!isBlockNoteJson(content)) return content;
  try {
    return blocksToMarkdown(JSON.parse(content));
  } catch {
    return content;
  }
}

/**
 * 统一取编辑器 blocks（服务端安全版）：
 * - 旧 BlockNote JSON：解析原样返回（解析失败返回 undefined）
 * - Markdown（新格式）：返回 undefined——编辑器挂载后经 editor.tryParseMarkdownToBlocks
 *   填充（模块级 markdownToBlocks 需要 prosemirror Schema，见 editor.tsx）
 */
export function toEditorBlocks(content: string | null | undefined): PartialBlock[] | undefined {
  if (!content || !isBlockNoteJson(content)) return undefined;
  try {
    return JSON.parse(content) as PartialBlock[];
  } catch {
    return undefined;
  }
}

/** 从 Markdown 提取首个 "# 一级标题" 作为文档标题（无则返回 null） */
export function extractMarkdownTitle(markdown: string): string | null {
  const m = markdown.match(/^# (.+)$/m);
  return m ? m[1].trim() : null;
}
