// 块 JSON 工具（服务端 AI 工具共用，重构阶段 B）：
// 基于 BlockNote JSON（规范存储格式）的展平/取文本/类型标签辅助。
// 与自研编辑器时代的 Markdown 切片 + {#id} 锚点方案彻底解耦。

import type Database from "better-sqlite3";
import { isBlockNoteJson, toBlocks } from "@/lib/content-server";
import { getDocumentById, updateDocument } from "@/lib/local/db";

/** 任意 BlockNote 块的最小形状（宽松，容忍存量数据缺字段） */
export interface AnyBlock {
  id?: string;
  type?: string;
  content?: unknown;
  children?: AnyBlock[];
  [key: string]: unknown;
}

/** 提取块纯文本：inline content 数组（[{type:"text",text,...}]）拼接；codeBlock 为字符串 */
export function blockText(b: AnyBlock): string {
  if (Array.isArray(b.content)) {
    return (b.content as Array<{ text?: unknown }>)
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
      .join("");
  }
  if (typeof b.content === "string") return b.content;
  return "";
}

/** 展平块树：每个块（含嵌套 children）带点号序号（[0]、[1]、[1.1]、[1.2]…） */
export function flattenBlocks(
  blocks: AnyBlock[],
  prefix = "",
): Array<{ index: string; block: AnyBlock }> {
  const out: Array<{ index: string; block: AnyBlock }> = [];
  blocks.forEach((b, i) => {
    const idx = prefix ? `${prefix}.${i + 1}` : `${i}`;
    out.push({ index: idx, block: b });
    if (b.children?.length) out.push(...flattenBlocks(b.children, idx));
  });
  return out;
}

/** 块类型中文标签 */
export const BLOCK_KIND_LABELS: Record<string, string> = {
  paragraph: "段落",
  heading: "标题",
  bulletListItem: "无序项",
  numberedListItem: "有序项",
  checkListItem: "任务项",
  quote: "引用",
  codeBlock: "代码块",
  divider: "分隔线",
  table: "表格",
  image: "图片",
  video: "视频",
  audio: "音频",
  file: "文件",
  toggleListItem: "折叠项",
};

export function kindLabel(type: string | undefined): string {
  return (type && BLOCK_KIND_LABELS[type]) || type || "未知";
}

/** 无文本内容块类型（content:"none"，updateBlock 拒绝更新） */
export const NO_CONTENT_BLOCK_TYPES = new Set([
  "divider",
  "table",
  "image",
  "video",
  "audio",
  "file",
]);

/**
 * 取文档的 BlockNote blocks；存量 Markdown 惰性转换并**写回 JSON**（块 ID 持久化，
 * 保证 getDocBlocks 拿到的 ID 在 updateBlock 中稳定可定位；顺带渐进迁移旧数据）。
 * 文档不存在或无权访问返回 null。
 */
export async function ensureDocBlocks(
  db: Database.Database,
  userId: string,
  noteId: string,
): Promise<{ blocks: AnyBlock[]; title: string } | null> {
  const doc = getDocumentById(db, noteId, userId);
  if (!doc) return null;
  if (isBlockNoteJson(doc.content)) {
    try {
      return { blocks: (JSON.parse(doc.content ?? "[]") as AnyBlock[]) ?? [], title: doc.title };
    } catch {
      return { blocks: [], title: doc.title };
    }
  }
  // 存量 Markdown：转换并写回，块 ID 从此稳定
  const blocks = (await toBlocks(doc.content)) as AnyBlock[];
  updateDocument(db, noteId, { content: JSON.stringify(blocks) });
  return { blocks, title: doc.title };
}
