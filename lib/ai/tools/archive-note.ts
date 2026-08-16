import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { setDocumentArchived } from "@/lib/local/db";

export function createArchiveNoteTool(db: Database.Database, userId: string) {
  return tool({
    description: "归档笔记到回收站（可恢复）。",
    inputSchema: z.object({
      noteId: z.string().describe("要归档的笔记 ID"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[archiveNote] 归档笔记", { noteId });

      if (!setDocumentArchived(db, userId, noteId, true)) {
        logger.tools.error("[archiveNote] 归档失败", { noteId });
        return `归档失败：笔记 ${noteId} 不存在或无权归档。`;
      }

      logger.tools.info("[archiveNote] 归档成功");
      return "笔记已归档到回收站。";
    },
  });
}
