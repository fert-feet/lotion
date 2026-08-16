import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { getDocumentById, updateDocument } from "@/lib/local/db";
import type { ToolEvent } from "./index";

export function createRenameNoteTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description: "重命名已有笔记的标题。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID（由 searchNotes 返回）"),
      title: z.string().describe("新的笔记标题"),
    }),
    execute: async ({ noteId, title }: { noteId: string; title: string }) => {
      logger.tools.info("[renameNote] 重命名笔记", { noteId, title });

      const existing = getDocumentById(db, noteId, userId);
      if (!existing) {
        return `笔记 ${noteId} 不存在或无权重命名。`;
      }
      updateDocument(db, noteId, { title });

      // 副作用通过 onEvent 上报：note_modified 驱动前端刷新，reference 流结束时汇总
      onEvent({ type: "note_modified", noteId, title });
      onEvent({ type: "reference", noteId, title });
      logger.tools.info("[renameNote] 重命名成功");
      return `标题已更新为「${title}」。`;
    },
  });
}