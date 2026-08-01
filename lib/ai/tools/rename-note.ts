import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import type { ToolEvent } from "./index";

export function createRenameNoteTool(
  supabase: SupabaseClient,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
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
        .eq("id", noteId)
        .eq("userId", userId);

      if (error) {
        logger.tools.error("[renameNote] 重命名失败", { error: String(error) });
        return `重命名失败：${error.message}`;
      }

      // 副作用通过 onEvent 上报：note_modified 驱动前端刷新，reference 流结束时汇总
      onEvent({ type: "note_modified", noteId });
      onEvent({ type: "reference", noteId, title });
      logger.tools.info("[renameNote] 重命名成功");
      return `标题已更新为「${title}」。`;
    },
  });
}
