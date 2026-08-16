import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { getDocumentById } from "@/lib/local/db";
import type { ToolEvent } from "./index";

export function createDeleteNoteTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description: "永久删除笔记。调用后系统会自动弹出确认框让用户二次确认，你不需要额外询问。",
    inputSchema: z.object({
      noteId: z.string().describe("要删除的笔记 ID"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[deleteNote] 请求删除确认", { noteId });

      // 查找标题用于确认提示（带所有权过滤）
      const doc = getDocumentById(db, noteId, userId);
      if (!doc) {
        return "笔记不存在或无权删除。";
      }

      // 不实际删除：通过 onEvent 上报确认请求，前端弹框由用户二次确认后才真正删除
      onEvent({ type: "confirm_delete", noteId, title: doc.title });

      logger.tools.info("[deleteNote] 等待用户确认", { noteId, title: doc.title });
      return `删除确认已发送。`;
    },
  });
}
