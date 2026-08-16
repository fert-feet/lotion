import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { getDocumentById, updateDocument } from "@/lib/local/db";
import type { ToolEvent } from "./index";

export function createSetNoteIconTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description: "设置笔记的 emoji 图标，或清除已有图标（icon 传空字符串）。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID"),
      icon: z.string().describe("emoji 图标（如 📚、🗂️）；传空字符串表示清除图标"),
    }),
    execute: async ({ noteId, icon }: { noteId: string; icon: string }) => {
      logger.tools.info("[setNoteIcon] 设置图标", { noteId, icon });

      const existing = getDocumentById(db, noteId, userId);
      if (!existing) {
        return `笔记 ${noteId} 不存在或无权操作。`;
      }

      updateDocument(db, noteId, { icon: icon.trim() || null });

      // 副作用：note_modified 驱动前端刷新，reference 流结束时汇总
      onEvent({ type: "note_modified", noteId, title: existing.title });
      onEvent({ type: "reference", noteId, title: existing.title });
      logger.tools.info("[setNoteIcon] 图标已更新", { noteId, icon: icon.trim() || null });
      return icon.trim()
        ? `已为笔记「${existing.title}」设置图标 ${icon.trim()}。`
        : `已清除笔记「${existing.title}」的图标。`;
    },
  });
}
