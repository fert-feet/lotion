import { tool } from "ai";
import z from "zod";
import { create, update } from "@/lib/db";

export function createCreateNoteTool(userId: string) {
  return tool({
    description: "创建一篇新笔记。标题应简洁地概括内容主题。",
    parameters: z.object({
      title: z.string().describe("笔记标题"),
      content: z.string().describe("笔记内容，按自然段书写"),
    }),
    execute: async ({ title, content }) => {
      const blocks = content.split("\n").map((line, i) => ({
        id: `ai-${Date.now()}-${i}`,
        type: "paragraph" as const,
        content: line ? [{ type: "text" as const, text: line }] : [],
      }));

      const docId = await create(userId, title);
      await update(docId, { content: JSON.stringify(blocks) });

      return `笔记「${title}」已创建 (id: ${docId})，内容已写入。`;
    },
  });
}
