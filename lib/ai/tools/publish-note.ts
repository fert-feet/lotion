import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { getDocumentById, updateDocument } from "@/lib/local/db";
import type { ToolEvent } from "./index";

export function createPublishNoteTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description:
      "发布或取消发布笔记：发布后任何人通过公开链接（公开预览页）无需登录即可查看；取消发布后恢复私密。",
    inputSchema: z.object({
      noteId: z.string().describe("要发布/取消发布的笔记 ID"),
      published: z.boolean().describe("true 发布；false 取消发布"),
    }),
    execute: async ({ noteId, published }: { noteId: string; published: boolean }) => {
      logger.tools.info("[publishNote] 设置发布状态", { noteId, published });

      const existing = getDocumentById(db, noteId, userId);
      if (!existing) {
        return `笔记 ${noteId} 不存在或无权操作。`;
      }
      if (existing.isPublished === published) {
        return published
          ? `笔记「${existing.title}」已处于发布状态。`
          : `笔记「${existing.title}」当前未发布。`;
      }

      updateDocument(db, userId, noteId, { isPublished: published });

      // 副作用：note_modified 驱动前端刷新，reference 流结束时汇总
      onEvent({ type: "note_modified", noteId, title: existing.title });
      onEvent({ type: "reference", noteId, title: existing.title });
      logger.tools.info("[publishNote] 已更新", { noteId, published });
      return published
        ? `笔记「${existing.title}」已发布，任何人可通过公开链接查看。`
        : `笔记「${existing.title}」已取消发布，恢复私密。`;
    },
  });
}
