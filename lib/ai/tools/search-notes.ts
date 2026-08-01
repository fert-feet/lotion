import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";

export function createSearchNotesTool(supabase: SupabaseClient, userId: string) {
  return tool({
    description: "按标题关键词搜索当前用户的所有笔记，返回匹配的笔记 ID 和标题。用于发现和定位笔记。",
    inputSchema: z.object({
      query: z.string().describe("搜索关键词：从用户请求中提炼 2-5 个关键词（去除'帮我''那篇''总结一下'等口语），用关键词而非完整句子"),
    }),
    execute: async ({ query }: { query: string }) => {
      logger.tools.info("[searchNotes] 搜索", { query });
      const { data: docs } = await supabase
        .from("documents")
        .select("id, title, content")
        .eq("userId", userId)
        .eq("isArchived", false)
        .order("createdAt", { ascending: false });

      const matches = (docs || []).filter((d) =>
        d.title.toLowerCase().includes(query.toLowerCase())
      );

      logger.tools.info("[searchNotes] 完成", { total: docs?.length ?? 0, matched: matches.length });

      if (matches.length === 0) {
        return `未找到标题包含「${query}」的笔记。`;
      }

      return (
        `找到 ${matches.length} 篇笔记：\n` +
        matches
          .map((d) => `- ${d.title} (id: ${d.id})${d.content ? ` | 摘要: ${d.content.slice(0, 80)}...` : ""}`)
          .join("\n")
      );
    },
  });
}
