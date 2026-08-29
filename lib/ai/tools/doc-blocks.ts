import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { getDocumentById } from "@/lib/local/db";
import { blockText, ensureDocBlocks, flattenBlocks, kindLabel } from "./blocks-util";

/** 块摘要长度 */
const SNIPPET_CHAR_LIMIT = 60;

export function createGetDocBlocksTool(db: Database.Database, userId: string) {
  return tool({
    description:
      "列出笔记的块清单（对齐 BlockNote 块模型）：每个块的序号、类型、块 ID 与文本摘要。用于精确定位块（配合 updateBlock 按块 ID 或序号更新）。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[getDocBlocks] 列出块", { noteId });
      const doc = getDocumentById(db, noteId, userId);
      if (!doc) {
        return `笔记 ${noteId} 不存在或无权访问。`;
      }

      // 规范存储为 BlockNote JSON；存量 Markdown 惰性转换并写回（块 ID 持久化）
      const { blocks } = (await ensureDocBlocks(db, userId, noteId))!;
      const flat = flattenBlocks(blocks);
      if (flat.length === 0 || (flat.length === 1 && !blockText(flat[0].block))) {
        return `笔记「${doc.title}」是空文档。`;
      }

      const lines = flat.map(({ index, block }) => {
        const kind = kindLabel(block.type);
        const id = block.id ? ` ID: ${block.id}` : "";
        const text = blockText(block).replace(/\n/g, " ").trim();
        const snippet = text.slice(0, SNIPPET_CHAR_LIMIT);
        const tail = text.length > SNIPPET_CHAR_LIMIT ? "..." : "";
        return `[${index}] (${kind})${id}${snippet ? ` 内容: ${snippet}${tail}` : ""}`;
      });

      return `笔记「${doc.title}」共 ${flat.length} 块：\n${lines.join("\n")}`;
    },
  });
}
