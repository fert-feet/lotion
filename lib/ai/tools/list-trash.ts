import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { listTrash } from "@/lib/local/db";

/** 回收站列表上限 */
const TRASH_LIMIT = 100;

export function createListTrashTool(db: Database.Database, userId: string) {
  return tool({
    description:
      "列出回收站中的笔记（已归档，按创建时间倒序），返回标题与 ID。用于查找可恢复的笔记（配合 restoreNote 使用）。",
    inputSchema: z.object({}),
    execute: async () => {
      logger.tools.info("[listTrash] 查看回收站");

      const items = listTrash(db, userId).slice(0, TRASH_LIMIT);
      if (items.length === 0) {
        return "回收站是空的。";
      }

      const lines = items.map((d) => `- ${d.title} (id: ${d.id})`);
      return `回收站中有 ${items.length} 篇笔记：\n${lines.join("\n")}`;
    },
  });
}
