import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { getDocumentById, getDescendantIds, moveDocument } from "@/lib/local/db";
import type { ToolEvent } from "./index";

export function createMoveNoteTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description:
      "移动笔记到另一个父笔记下（嵌套组织），或移到根目录（newParentId 传 null）。目标父笔记必须存在、属于当前用户且未归档；不能移动到自身或自己的子笔记下。",
    inputSchema: z.object({
      noteId: z.string().describe("要移动的笔记 ID"),
      newParentId: z.string().nullable().describe("目标父笔记 ID；传 null 表示移到根目录（顶层）"),
    }),
    execute: async ({ noteId, newParentId }: { noteId: string; newParentId: string | null }) => {
      logger.tools.info("[moveNote] 移动笔记", { noteId, newParentId });

      const existing = getDocumentById(db, noteId, userId);
      if (!existing) {
        return `笔记 ${noteId} 不存在或无权移动。`;
      }

      if (newParentId !== null) {
        const target = getDocumentById(db, newParentId, userId);
        if (!target) {
          return `目标父笔记 ${newParentId} 不存在或无权访问。`;
        }
        if (target.isArchived) {
          return `目标父笔记「${target.title}」已归档，不能移动到其下。`;
        }
        // 防循环：目标不能位于被移动文档的子树中
        const descendants = getDescendantIds(db, userId, noteId);
        if (descendants.includes(newParentId)) {
          return `不能将笔记移动到自身或其子笔记下（会形成循环嵌套）。`;
        }
      }

      if (!moveDocument(db, userId, noteId, newParentId)) {
        return `移动失败：笔记 ${noteId} 不存在或无权移动。`;
      }

      // 副作用：note_modified 驱动前端刷新，reference 流结束时汇总
      onEvent({ type: "note_modified", noteId, title: existing.title });
      onEvent({ type: "reference", noteId, title: existing.title });
      logger.tools.info("[moveNote] 移动成功", { noteId, newParentId });
      return newParentId === null
        ? `笔记「${existing.title}」已移动到根目录。`
        : `笔记「${existing.title}」已移动到「${getDocumentById(db, newParentId, userId)!.title}」下。`;
    },
  });
}
