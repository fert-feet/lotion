// 回收站生命周期工具（归档 / 恢复 / 查看）。
//
// 合并背景：`archiveNote` / `restoreNote` / `listTrash` 是同一件事的三个动作，
// 各自带一份 schema 与描述，随每次请求一起进 prompt。合成一个带 `action` 的工具后，
// 固定 prompt 少两份 schema，模型也不必在三个近义工具间选择。
//
// 注意：`deleteNote`（永久删除，需用户确认）**不**合并进来——它是不可逆操作，
// 单独的工具名能让提示词与前端确认流程保持清晰。
import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import {
  getDocumentById,
  listTrash as listTrashDocs,
  restoreDocument,
  setDocumentArchived,
} from "@/lib/local/db";
import type { ToolEvent } from "./index";

/** 回收站列表上限 */
const TRASH_LIMIT = 100;

export function createManageTrashTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description:
      "回收站操作。action=list 列出回收站中的笔记（返回标题与 ID）；" +
      "action=archive 归档一篇笔记（可恢复）；" +
      "action=restore 从回收站恢复一篇笔记（连同子笔记，父笔记仍在回收站时自动移到根目录）。",
    inputSchema: z.object({
      action: z.enum(["list", "archive", "restore"]).describe("要执行的动作"),
      noteId: z
        .string()
        .optional()
        .describe("笔记 ID；action=archive / restore 时必填（restore 的 ID 由 list 返回）"),
    }),
    execute: async ({ action, noteId }: { action: "list" | "archive" | "restore"; noteId?: string }) => {
      if (action === "list") {
        logger.tools.info("[manageTrash] 查看回收站");
        const items = listTrashDocs(db, userId).slice(0, TRASH_LIMIT);
        if (items.length === 0) return "回收站是空的。";
        const lines = items.map((d) => `- ${d.title} (id: ${d.id})`);
        return `回收站中有 ${items.length} 篇笔记：\n${lines.join("\n")}`;
      }

      if (!noteId) {
        return `action=${action} 需要提供 noteId（先 action=list 查看回收站）。`;
      }

      if (action === "archive") {
        logger.tools.info("[manageTrash] 归档笔记", { noteId });
        if (!setDocumentArchived(db, userId, noteId, true)) {
          logger.tools.error("[manageTrash] 归档失败", { noteId });
          return `归档失败：笔记 ${noteId} 不存在或无权归档。`;
        }
        return "笔记已归档到回收站。";
      }

      // restore
      logger.tools.info("[manageTrash] 恢复笔记", { noteId });
      const existing = getDocumentById(db, noteId, userId);
      if (!existing) return `笔记 ${noteId} 不存在或无权恢复。`;
      if (!existing.isArchived) return `笔记「${existing.title}」不在回收站中，无需恢复。`;

      restoreDocument(db, userId, noteId);
      // 副作用：note_modified 驱动前端刷新，reference 流结束时汇总
      onEvent({ type: "note_modified", noteId, title: existing.title });
      onEvent({ type: "reference", noteId, title: existing.title });
      return `笔记「${existing.title}」已从回收站恢复。`;
    },
  });
}
