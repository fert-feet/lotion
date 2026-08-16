import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { getDocumentById, getDescendantIds } from "@/lib/local/db";
import type { ToolEvent } from "./index";

/**
 * 移动笔记（对齐 SiYuan 写操作确认）：移动是结构性操作，
 * 调用后先做静态校验（目标存在/未归档/防循环），校验通过后
 * 经 confirm_move 事件上报确认请求——前端弹卡由用户二次确认，
 * 确认后前端调 PUT /api/documents/[id]/move 真正执行。
 */
export function createMoveNoteTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description:
      "移动笔记到另一个父笔记下（嵌套组织），或移到根目录（newParentId 传 null）。调用后系统会弹出确认框让用户二次确认，你不需要额外询问。",
    inputSchema: z.object({
      noteId: z.string().describe("要移动的笔记 ID"),
      newParentId: z.string().nullable().describe("目标父笔记 ID；传 null 表示移到根目录（顶层）"),
    }),
    execute: async ({ noteId, newParentId }: { noteId: string; newParentId: string | null }) => {
      logger.tools.info("[moveNote] 请求移动确认", { noteId, newParentId });

      const existing = getDocumentById(db, noteId, userId);
      if (!existing) {
        return `笔记 ${noteId} 不存在或无权移动。`;
      }

      // 确认前先做静态校验：目标必须存在、未归档、不在被移动文档的子树中
      let targetTitle: string | null = null;
      if (newParentId !== null) {
        const target = getDocumentById(db, newParentId, userId);
        if (!target) {
          return `目标父笔记 ${newParentId} 不存在或无权访问。`;
        }
        if (target.isArchived) {
          return `目标父笔记「${target.title}」已归档，不能移动到其下。`;
        }
        const descendants = getDescendantIds(db, userId, noteId);
        if (descendants.includes(newParentId)) {
          return `不能将笔记移动到自身或其子笔记下（会形成循环嵌套）。`;
        }
        targetTitle = target.title;
      }

      // 不实际移动：通过 onEvent 上报确认请求，前端弹卡由用户二次确认后走 REST 执行
      onEvent({
        type: "confirm_move",
        noteId,
        title: existing.title,
        targetTitle,
        toRoot: newParentId === null,
      });
      logger.tools.info("[moveNote] 等待用户确认", { noteId, newParentId, title: existing.title });
      return `移动确认已发送。`;
    },
  });
}
