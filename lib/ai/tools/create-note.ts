import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { markdownToBlocks, extractTitle } from "@/lib/markdown-to-blocks";
import type { ToolEvent } from "./index";

export function createCreateNoteTool(
  supabase: SupabaseClient,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  // 幂等防重（PandaWiki 启发）：本次对话已创建过笔记时拒绝再次创建，
  // 根治 AI 重复调用 createNote 留下多篇草稿。tool 实例按请求创建，
  // 闭包状态天然按请求隔离，无需外部共享对象。
  let createdNoteId: string | null = null;

  return tool({
    description: "创建一篇新笔记。标题应简洁地概括内容主题。",
    inputSchema: z.object({
      title: z.string().describe("笔记标题"),
      content: z.string().describe("笔记内容，使用 Markdown 格式书写，支持标题、加粗、列表、代码块等"),
    }),
    execute: async ({ title, content }: { title: string; content: string }) => {
      if (createdNoteId) {
        logger.tools.warn("[createNote] 拒绝重复创建", { existingNoteId: createdNoteId });
        return `本次对话已经创建过笔记（ID: ${createdNoteId}）。请直接使用该 ID 调用 updateNote 修改内容，不要重复创建新笔记。`;
      }

      logger.tools.info("[createNote] 创建笔记", { title, contentLen: content.length });

      // 先转换 Markdown 再插入：转换失败不会留下空笔记
      const blocks = markdownToBlocks(content);
      // 正文开头的 # 一级标题作为文档 title（AI 的 title 参数可能为空或与正文不一致）
      const { title: extractedTitle, blocks: contentBlocks } = extractTitle(blocks);
      const finalTitle = extractedTitle || title;

      const { data: doc, error } = await supabase
        .from("documents")
        .insert({ title: finalTitle, userId, content: JSON.stringify(contentBlocks), isArchived: false, isPublished: false, isDraft: true })
        .select("id")
        .single();

      if (error || !doc) {
        logger.tools.error("[createNote] 创建失败", { error: String(error) });
        return `创建笔记失败：${error?.message || "未知错误"}`;
      }

      createdNoteId = doc.id;
      // 副作用通过 onEvent 上报：note_created 驱动前端跳转，reference 在流结束时汇总展示胶囊
      onEvent({ type: "note_created", noteId: doc.id });
      onEvent({ type: "reference", noteId: doc.id, title: finalTitle });
      logger.tools.info("[createNote] 已创建", { noteId: doc.id, blockCount: contentBlocks.length, title: finalTitle });

      return `笔记「${title}」已创建（ID: ${doc.id}），内容已写入。如果觉得内容需要调整，可用此 ID 调用 updateNote 修改。`;
    },
  });
}
