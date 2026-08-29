// 文档内容适配层·客户端安全部分（重构阶段 B）：
// 仅存放不依赖 BlockNote/服务端运行时（JSDOM/prosemirror）的纯函数，
// 供客户端编辑器与公共模块导入。服务端转换（toMarkdown / toBlocks）在
// lib/content-server.ts（内部使用 @blocknote/server-util，禁止客户端导入）。

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
 *   填充（见 app/(main)/_components/editor.tsx）
 */
export function toEditorBlocks(content: string | null | undefined): EditorBlockLike[] | undefined {
  if (!content || !isBlockNoteJson(content)) return undefined;
  try {
    return JSON.parse(content) as EditorBlockLike[];
  } catch {
    return undefined;
  }
}

/** 从 Markdown 提取首个 "# 一级标题" 作为文档标题（无则返回 null） */
export function extractMarkdownTitle(markdown: string): string | null {
  const m = markdown.match(/^# (.+)$/m);
  return m ? m[1].trim() : null;
}
