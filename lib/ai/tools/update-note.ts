import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { markdownToBlocks } from "@/lib/markdown-to-blocks";

export function createUpdateNoteTool(
  supabase: SupabaseClient,
  pendingModifiedNoteId: { current: string | null } = { current: null },
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

      const { error } = await supabase
        .from("documents")
        .update({ content: JSON.stringify(blocks) })
        .eq("id", noteId);

      if (error) {
        logger.tools.error("[updateNote] 更新失败", { error: String(error) });
        return `更新失败：${error.message}`;
      }

      pendingModifiedNoteId.current = noteId;
      logger.tools.info("[updateNote] 更新成功", { noteId, blockCount: blocks.length });
      return `笔记内容已更新。`;
    },
  });
}
