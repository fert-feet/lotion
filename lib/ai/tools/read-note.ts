import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";

export function createReadNoteTool(supabase: SupabaseClient) {
  return tool({
    description: "读取指定笔记的完整内容。需要先通过 searchNotes 获取笔记 ID。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID（由 searchNotes 返回）"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[readNote] 读取笔记", { noteId });
      const { data: doc, error } = await supabase
        .from("documents")
        .select("title, content")
        .eq("id", noteId)
        .single();

      if (error || !doc) {
        logger.tools.warn("[readNote] 笔记不存在", { noteId });
        return `笔记 ${noteId} 不存在或无权访问。`;
      }

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
    },
  });
}
