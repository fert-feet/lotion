import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { extractText } from "@/lib/extract-text";
import { countChildDocuments, getDocumentById } from "@/lib/local/db";

export function createGetDocInfoTool(db: Database.Database, userId: string) {
  return tool({
    description:
      "获取笔记的元数据信息：标题、图标、发布时间、草稿状态、子文档数、正文字数、创建与更新时间。用于快速了解一篇笔记的概况（不返回正文）。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[getDocInfo] 读取笔记信息", { noteId });
      const doc = getDocumentById(db, noteId, userId);
      if (!doc) {
        return `笔记 ${noteId} 不存在或无权访问。`;
      }

      const text = extractText(doc.content || "");
      const childCount = countChildDocuments(db, userId, noteId);

      const lines = [
        `标题: ${doc.title}`,
        `ID: ${doc.id}`,
        doc.icon ? `图标: ${doc.icon}` : "",
        `字数: ${text.length} 字`,
        `子文档: ${childCount} 篇`,
        `状态: ${doc.isPublished ? "已发布（公开可访问）" : "私密"}${doc.isArchived ? "（在回收站）" : ""}${doc.isDraft ? "（草稿）" : ""}`,
        `创建: ${doc.createdAt}`,
        `更新: ${doc.updatedAt}`,
      ].filter(Boolean);
      return `笔记「${doc.title}」信息：\n${lines.join("\n")}`;
    },
  });
}
