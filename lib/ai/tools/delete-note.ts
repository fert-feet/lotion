import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";

export function createDeleteNoteTool(
  supabase: SupabaseClient,
  userId: string,
  pendingConfirmDelete: { current: { noteId: string; title: string } | null },
) {
  return tool({
    description: "永久删除笔记。调用后系统会自动弹出确认框让用户二次确认，你不需要额外询问。",
    inputSchema: z.object({
      noteId: z.string().describe("要删除的笔记 ID"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[deleteNote] 请求删除确认", { noteId });

      // 查找标题用于确认提示
      const { data: doc } = await supabase
        .from("documents")
        .select("title")
        .eq("id", noteId)
        .eq("userId", userId)
        .single();

      if (!doc) {
        return "笔记不存在或无权删除。";
      }

      // 不实际删除，设置待确认标记
      pendingConfirmDelete.current = { noteId, title: doc.title };

      logger.tools.info("[deleteNote] 等待用户确认", { noteId, title: doc.title });
      return `删除确认已发送。`;
    },
  });
}
