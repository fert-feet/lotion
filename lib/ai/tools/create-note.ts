import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";

export function createCreateNoteTool(supabase: SupabaseClient, userId: string) {
  return tool({
    description: "创建一篇新笔记。标题应简洁地概括内容主题。",
    inputSchema: z.object({
      title: z.string().describe("笔记标题"),
      content: z.string().describe("笔记内容，按自然段书写"),
    }),
    execute: async ({ title, content }: { title: string; content: string }) => {
      logger.tools.info("[createNote] 创建笔记", { title, contentLen: content.length });

      const { data: doc, error } = await supabase
        .from("documents")
        .insert({ title, userId, isArchived: false, isPublished: false })
        .select("id")
        .single();

      if (error || !doc) {
        logger.tools.error("[createNote] 创建失败", { error: String(error) });
        return `创建笔记失败：${error?.message || "未知错误"}`;
      }

      const blocks = content.split("\n").map((line, i) => ({
        id: `ai-${Date.now()}-${i}`,
        type: "paragraph" as const,
        content: line ? [{ type: "text" as const, text: line }] : [],
      }));

      await supabase
        .from("documents")
        .update({ content: JSON.stringify(blocks) })
        .eq("id", doc.id);

      return `笔记「${title}」已创建 (id: ${doc.id})，内容已写入。`;
    },
  });
}
