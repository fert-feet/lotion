import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { getDocumentById } from "@/lib/local/db";

/** BlockNote 块的最小形状（只关心 heading） */
interface OutlineBlock {
  type?: string;
  content?: Array<{ text?: string }>;
  children?: OutlineBlock[];
}

/**
 * 从 BlockNote JSON 提取标题层级大纲。
 * BlockNote 的 content 结构可能是扁平的（无嵌套 children），按出现顺序输出；
 * 若存在嵌套 children 则递归展开。返回带缩进的层级列表。
 */
function collectHeadings(blocks: OutlineBlock[], depth = 0, out: Array<{ level: number; text: string }> = []): Array<{ level: number; text: string }> {
  for (const b of blocks) {
    if (typeof b?.type === "string" && b.type.startsWith("heading")) {
      const level = Number(b.type.replace("heading", "")) || 1;
      const text = b.content?.map((c) => c.text || "").join("") || "";
      if (text) out.push({ level, text });
    }
    if (Array.isArray(b?.children) && b.children.length > 0) {
      collectHeadings(b.children, depth + 1, out);
    }
  }
  return out;
}

export function createGetDocOutlineTool(db: Database.Database, userId: string) {
  return tool({
    description:
      "获取笔记的大纲（标题层级树）：解析正文中的 heading 块，按层级缩进输出。用于快速了解文档结构、定位章节。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[getDocOutline] 读取大纲", { noteId });
      const doc = getDocumentById(db, noteId, userId);
      if (!doc) {
        return `笔记 ${noteId} 不存在或无权访问。`;
      }

      let blocks: OutlineBlock[] = [];
      try {
        const parsed = JSON.parse(doc.content || "[]");
        if (Array.isArray(parsed)) blocks = parsed;
      } catch {
        blocks = [];
      }

      const headings = collectHeadings(blocks);
      if (headings.length === 0) {
        return `笔记「${doc.title}」没有标题结构（大纲为空）。`;
      }

      const lines = headings.map((h) => "  ".repeat(h.level - 1) + "- " + h.text);
      return `笔记「${doc.title}」大纲：\n${lines.join("\n")}`;
    },
  });
}
