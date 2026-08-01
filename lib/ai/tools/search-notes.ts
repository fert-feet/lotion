import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { extractText } from "@/lib/extract-text";

/** 搜索结果上限 */
const SEARCH_LIMIT = 20;
/** 返回给模型的摘要长度 */
const SNIPPET_CHAR_LIMIT = 80;

export function createSearchNotesTool(supabase: SupabaseClient, userId: string) {
  return tool({
    description: "按标题关键词搜索当前用户的所有笔记，返回匹配的笔记 ID、标题和摘要。用于发现和定位笔记。",
    inputSchema: z.object({
      query: z.string().describe("搜索关键词：从用户请求中提炼 2-5 个关键词（去除'帮我''那篇''总结一下'等口语），用关键词而非完整句子"),
    }),
    execute: async ({ query }: { query: string }) => {
      logger.tools.info("[searchNotes] 搜索", { query });

      // 转义 LIKE 通配符（% _ \），防止查询串里的特殊字符扩大匹配范围
      const escaped = query.replace(/[\\%_]/g, (m) => `\\${m}`);

      // 服务端 ILIKE 过滤：不再全量拉取用户文档到内存匹配
      const { data: docs } = await supabase
        .from("documents")
        .select("id, title, content")
        .eq("userId", userId)
        .eq("isArchived", false)
        .ilike("title", `%${escaped}%`)
        .order("createdAt", { ascending: false })
        .limit(SEARCH_LIMIT);

      const matches = docs || [];
      logger.tools.info("[searchNotes] 完成", { matched: matches.length, limit: SEARCH_LIMIT });

      if (matches.length === 0) {
        return `未找到标题包含「${query}」的笔记。`;
      }

      const lines = matches.map((d: { id: string; title: string; content: string | null }) => {
        const snippet = extractText(d.content || "").slice(0, SNIPPET_CHAR_LIMIT);
        return `- ${d.title} (id: ${d.id})${snippet ? ` | 摘要: ${snippet}...` : ""}`;
      });

      return `找到 ${matches.length} 篇笔记：\n${lines.join("\n")}`;
    },
  });
}
