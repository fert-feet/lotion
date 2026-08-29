import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { toMarkdown } from "@/lib/content";
import { getDocumentById } from "@/lib/local/db";
import { parseGfm } from "@/components/markdown/parse";

/**
 * 从 Markdown 提取标题层级大纲（mdast heading，带层级缩进）。
 * 旧格式 BlockNote JSON 经 toMarkdown 统一转换后同样生效。
 */
function collectHeadings(markdown: string): Array<{ level: number; text: string }> {
  const root = parseGfm(markdown);
  const out: Array<{ level: number; text: string }> = [];
  const walk = (nodes: typeof root.children) => {
    for (const node of nodes) {
      if (node.type === "heading") {
        const text = (node.children ?? [])
          .map((c) => ("value" in c ? c.value : ""))
          .join("");
        if (text) out.push({ level: node.depth, text });
      }
      if ("children" in node) walk(node.children as typeof root.children);
    }
  };
  walk(root.children);
  return out;
}

export function createGetDocOutlineTool(db: Database.Database, userId: string) {
  return tool({
    description:
      "获取笔记的大纲（标题层级树）：解析正文中的标题，按层级缩进输出。用于快速了解文档结构、定位章节。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[getDocOutline] 读取大纲", { noteId });
      const doc = getDocumentById(db, noteId, userId);
      if (!doc) {
        return `笔记 ${noteId} 不存在或无权访问。`;
      }

      const headings = collectHeadings(await toMarkdown(doc.content));
      if (headings.length === 0) {
        return `笔记「${doc.title}」没有标题结构（大纲为空）。`;
      }

      const lines = headings.map((h) => "  ".repeat(h.level - 1) + "- " + h.text);
      return `笔记「${doc.title}」大纲：\n${lines.join("\n")}`;
    },
  });
}
