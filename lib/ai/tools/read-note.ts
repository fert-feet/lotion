import { tool } from "ai";
import z from "zod";
import { getById } from "@/lib/db";

export function createReadNoteTool(_userId: string) {
  return tool({
    description: "读取指定笔记的完整内容。需要先通过 searchNotes 获取笔记 ID。",
    parameters: z.object({
      noteId: z.string().describe("笔记 ID（由 searchNotes 返回）"),
    }),
    execute: async ({ noteId }) => {
      try {
        const doc = await getById(noteId);

        if (!doc.content) {
          return `笔记「${doc.title}」内容为空。`;
        }

        let text = doc.content;
        try {
          const blocks = JSON.parse(doc.content);
          if (Array.isArray(blocks)) {
            text = blocks
              .map((b: any) => b.content?.map((c: any) => c.text || "").join("") || "")
              .filter(Boolean)
              .join("\n");
          }
        } catch {
          // 纯文本
        }

        return `笔记「${doc.title}」内容：\n\n${text}`;
      } catch {
        return `笔记 ${noteId} 不存在或无权访问。`;
      }
    },
  });
}
