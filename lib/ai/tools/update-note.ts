import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { markdownToBlocks, extractTitle } from "@/lib/markdown-to-blocks";
import { getDocumentById, updateDocument } from "@/lib/local/db";
import type { ToolEvent } from "./index";

export function createUpdateNoteTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description: "修改已有笔记的内容。先通过 readNote 读取当前内容，再调用此工具更新。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID（由 searchNotes 返回）"),
      content: z.string().describe("新的笔记内容，使用 Markdown 格式"),
    }),
    execute: async ({ noteId, content }: { noteId: string; content: string }) => {
      logger.tools.info("[updateNote] 更新笔记", { noteId, contentLen: content.length });

      const blocks = markdownToBlocks(content);
      // 正文开头的 # 一级标题提取为文档 title，避免页面重复标题
      const { title: extractedTitle, blocks: contentBlocks } = extractTitle(blocks);

      const existing = getDocumentById(db, noteId, userId);
      if (!existing) {
        return `笔记 ${noteId} 不存在或无权修改。`;
      }

      const fields: Record<string, string> = { content: JSON.stringify(contentBlocks) };
      if (extractedTitle) fields.title = extractedTitle;
      updateDocument(db, noteId, fields);

      // 副作用通过 onEvent 上报：note_modified 驱动前端刷新，reference 流结束时汇总
      onEvent({ type: "note_modified", noteId, title: extractedTitle || existing.title || "笔记" });
      onEvent({ type: "reference", noteId, title: extractedTitle || existing.title || "笔记" });
      logger.tools.info("[updateNote] 更新成功", { noteId, blockCount: contentBlocks.length, extractedTitle: extractedTitle ?? undefined });
      return `笔记内容已更新。`;
    },
  });
}