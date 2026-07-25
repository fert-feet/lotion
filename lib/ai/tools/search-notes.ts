import { tool } from "ai";
import z from "zod";
import { getSearch } from "@/lib/db";

export function createSearchNotesTool(userId: string) {
  return tool({
    description: "按标题关键词搜索当前用户的所有笔记，返回匹配的笔记 ID 和标题。用于发现和定位笔记。",
    parameters: z.object({
      query: z.string().describe("搜索关键词，会匹配标题"),
    }),
    execute: async ({ query }) => {
      const docs = await getSearch(userId);
      const matches = docs.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()));

      if (matches.length === 0) {
        return `未找到标题包含「${query}」的笔记。`;
      }

      return (
        `找到 ${matches.length} 篇笔记：\n` +
        matches.map((d) => `- ${d.title} (id: ${d.id})${d.content ? ` | 内容摘要: ${d.content.slice(0, 80)}...` : ""}`).join("\n")
      );
    },
  });
}
