import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { listDocumentsOverview } from "@/lib/local/db";

/** 目录浏览结果上限 */
const LIST_LIMIT = 100;

export function createListNotesTool(db: Database.Database, userId: string) {
  return tool({
    description:
      "浏览笔记目录：不传 parentDocumentId 时列出全部未归档笔记（按最近更新倒序），传入时只列出该笔记的直接子文档。返回标题、ID、更新时间与子文档数量，用于导航（如「我的笔记有哪些」「打开某篇的子笔记」）。",
    inputSchema: z.object({
      parentDocumentId: z
        .string()
        .optional()
        .describe("父笔记 ID（可选）：只列出该笔记的直接子文档；不传则列出全部笔记"),
    }),
    execute: async ({ parentDocumentId }: { parentDocumentId?: string }) => {
      logger.tools.info("[listNotes] 浏览目录", { parentDocumentId: parentDocumentId ?? null });

      const rows = listDocumentsOverview(db, userId, parentDocumentId ?? null, LIST_LIMIT);
      if (rows.length === 0) {
        return parentDocumentId
          ? `笔记 ${parentDocumentId} 没有子笔记，或该笔记不存在/无权访问。`
          : "当前没有任何笔记。";
      }

      const lines = rows.map((d) => {
        const child = d.childCount > 0 ? `（含 ${d.childCount} 篇子笔记）` : "";
        return `- ${d.title} (id: ${d.id}) | 更新于 ${d.updatedAt}${child}`;
      });
      return `找到 ${rows.length} 篇笔记：\n${lines.join("\n")}`;
    },
  });
}
