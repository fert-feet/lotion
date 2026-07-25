import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";

export function createArchiveNoteTool(supabase: SupabaseClient, userId: string) {
  return tool({
    description: "归档笔记到回收站（可恢复）。",
    inputSchema: z.object({
      noteId: z.string().describe("要归档的笔记 ID"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[archiveNote] 归档笔记", { noteId });

      const { error } = await supabase
        .from("documents")
        .update({ isArchived: true })
        .eq("id", noteId)
        .eq("userId", userId);

      if (error) {
        logger.tools.error("[archiveNote] 归档失败", { error: String(error) });
        return `归档失败：${error.message}`;
      }

      logger.tools.info("[archiveNote] 归档成功");
      return "笔记已归档到回收站。";
    },
  });
}
