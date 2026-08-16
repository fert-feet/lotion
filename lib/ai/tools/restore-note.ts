import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { getDocumentById, restoreDocument } from "@/lib/local/db";
import type { ToolEvent } from "./index";

export function createRestoreNoteTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description:
      "从回收站恢复已归档的笔记（连同其子笔记一起恢复）。如果父笔记仍在回收站中，恢复后该笔记会自动移到根目录。",
    inputSchema: z.object({
      noteId: z.string().describe("要恢复的笔记 ID（由 listTrash 返回）"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[restoreNote] 恢复笔记", { noteId });

      const existing = getDocumentById(db, noteId, userId);
      if (!existing) {
        return `笔记 ${noteId} 不存在或无权恢复。`;
      }
      if (!existing.isArchived) {
        return `笔记「${existing.title}」不在回收站中，无需恢复。`;
      }

      restoreDocument(db, userId, noteId);

      // 副作用：note_modified 驱动前端刷新，reference 流结束时汇总
      onEvent({ type: "note_modified", noteId, title: existing.title });
      onEvent({ type: "reference", noteId, title: existing.title });
      logger.tools.info("[restoreNote] 恢复成功", { noteId });
      return `笔记「${existing.title}」已从回收站恢复。`;
    },
  });
}
