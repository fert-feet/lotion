import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { extractText } from "@/lib/extract-text";
import { searchDocuments } from "@/lib/local/db";

/** 搜索结果上限 */
const SEARCH_LIMIT = 20;
/** 返回给模型的摘要长度 */
const SNIPPET_CHAR_LIMIT = 80;

export function createSearchNotesTool(db: Database.Database, userId: string) {
  return tool({
    description:
      "搜索当前用户的笔记：按关键词匹配标题和正文内容，返回匹配的笔记 ID、标题和摘要。不传关键词时返回全部笔记（按最近更新排序）。用于发现和定位笔记。",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe(
          "搜索关键词：从用户请求中提炼 2-5 个关键词（去除'帮我''那篇''总结一下'等口语），用关键词而非完整句子；用户想看全部笔记时不传或传空字符串",
        ),
    }),
    execute: async ({ query }: { query?: string }) => {
      const q = (query ?? "").trim();
      logger.tools.info("[searchNotes] 搜索", { query: q || null });

      // 本地 SQLite 标题+正文 LIKE 过滤（ASCII 大小写不敏感，通配符在 SQL 层转义）；
      // 空 query 返回全部未归档笔记（按最近更新倒序），支撑"查看我的所有笔记"类请求
      const matches = searchDocuments(db, userId, q, SEARCH_LIMIT);
      logger.tools.info("[searchNotes] 完成", { matched: matches.length, limit: SEARCH_LIMIT });

      if (matches.length === 0) {
        return q ? `未找到标题或正文包含「${q}」的笔记。` : "当前没有任何笔记。";
      }

      const lines = matches.map((d) => {
        const snippet = extractText(d.content || "").slice(0, SNIPPET_CHAR_LIMIT);
        return `- ${d.title} (id: ${d.id})${snippet ? ` | 摘要: ${snippet}...` : ""}`;
      });

      return `找到 ${matches.length} 篇笔记：\n${lines.join("\n")}`;
    },
  });
}
