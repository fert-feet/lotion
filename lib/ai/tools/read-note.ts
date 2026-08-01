import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { extractText } from "@/lib/extract-text";

/** 单次读取返回给模型的正文长度上限：超出部分截断并提示，避免撑爆上下文 */
const READ_NOTE_CHAR_LIMIT = 8000;

export function createReadNoteTool(supabase: SupabaseClient, userId: string) {
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
        .eq("userId", userId)
        .single();

      if (error || !doc) {
        logger.tools.warn("[readNote] 笔记不存在", { noteId });
        return `笔记 ${noteId} 不存在或无权访问。`;
      }

      const text = extractText(doc.content || "");
      if (!text) {
        return `笔记「${doc.title}」内容为空。`;
      }

      if (text.length > READ_NOTE_CHAR_LIMIT) {
        logger.tools.info("[readNote] 内容超长已截断", { noteId, total: text.length, limit: READ_NOTE_CHAR_LIMIT });
        return `笔记「${doc.title}」内容（前 ${READ_NOTE_CHAR_LIMIT} 字符，全文共 ${text.length} 字符）：\n\n${text.slice(0, READ_NOTE_CHAR_LIMIT)}`;
      }

      return `笔记「${doc.title}」内容：\n\n${text}`;
    },
  });
}
