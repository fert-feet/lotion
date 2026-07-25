import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";

export function createRenameNoteTool(supabase: SupabaseClient) {
  return tool({
    description: "重命名已有笔记的标题。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID（由 searchNotes 返回）"),
      title: z.string().describe("新的笔记标题"),
    }),
    execute: async ({ noteId, title }: { noteId: string; title: string }) => {
      logger.tools.info("[renameNote] 重命名笔记", { noteId, title });

      const { error } = await supabase
        .from("documents")
        .update({ title })
        .eq("id", noteId);

      if (error) {
        logger.tools.error("[renameNote] 重命名失败", { error: String(error) });
        return `重命名失败：${error.message}`;
      }

      logger.tools.info("[renameNote] 重命名成功");
      return `标题已更新为「${title}」。`;
    },
  });
}
