import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { markdownToBlocks } from "@/lib/markdown-to-blocks";

export function createCreateNoteTool(supabase: SupabaseClient, userId: string, pendingNoteId: { current: string | null } = { current: null }) {
  return tool({
    description: "创建一篇新笔记。标题应简洁地概括内容主题。",
    inputSchema: z.object({
      title: z.string().describe("笔记标题"),
      content: z.string().describe("笔记内容，使用 Markdown 格式书写，支持标题、加粗、列表、代码块等"),
    }),
    execute: async ({ title, content }: { title: string; content: string }) => {
      logger.tools.info("[createNote] 创建笔记", { title, contentLen: content.length });

      const { data: doc, error } = await supabase
        .from("documents")
        .insert({ title, userId, isArchived: false, isPublished: false, isDraft: true })
        .select("id")
        .single();

      if (error || !doc) {
        logger.tools.error("[createNote] 创建失败", { error: String(error) });
        return `创建笔记失败：${error?.message || "未知错误"}`;
      }

      const blocks = markdownToBlocks(content);

      await supabase
        .from("documents")
        .update({ content: JSON.stringify(blocks) })
        .eq("id", doc.id);

      pendingNoteId.current = doc.id;
      logger.tools.info("[createNote] 已转换并写入", { noteId: doc.id, blockCount: blocks.length });

      return `笔记「${title}」已创建（ID: ${doc.id}），内容已写入。如果觉得内容需要调整，可用此 ID 调用 updateNote 修改。`;
    },
  });
}
