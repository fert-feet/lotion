import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { extractMarkdownTitle, toBlocks } from "@/lib/content-server";
import { createDocument, getDocumentById, updateDocument } from "@/lib/local/db";
import type { ToolEvent } from "./index";

export function createCreateNoteTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  // 幂等防重（PandaWiki 启发）：本次对话已创建过笔记时拒绝再次创建，
  // 根治 AI 重复调用 createNote 留下多篇草稿。tool 实例按请求创建，
  // 闭包状态天然按请求隔离，无需外部共享对象。
  let createdNoteId: string | null = null;

  return tool({
    description:
      "创建一篇新笔记。标题应简洁地概括内容主题。可指定 parentDocumentId 在该笔记下创建子笔记（不指定则创建在根目录）。",
    inputSchema: z.object({
      title: z.string().describe("笔记标题"),
      content: z.string().describe("笔记内容，使用 Markdown 格式书写，支持标题、加粗、列表、代码块等（系统会转换为块存储）"),
      parentDocumentId: z.string().optional().describe("父笔记 ID（可选）：在该笔记下创建子笔记"),
    }),
    execute: async ({ title, content, parentDocumentId }: { title: string; content: string; parentDocumentId?: string }) => {
      if (createdNoteId) {
        logger.tools.warn("[createNote] 拒绝重复创建", { existingNoteId: createdNoteId });
        return `本次对话已经创建过笔记（ID: ${createdNoteId}）。请直接使用该 ID 调用 updateNote 修改内容，不要重复创建新笔记。`;
      }

      let parentTitle: string | null = null;
      if (parentDocumentId) {
        const parent = getDocumentById(db, parentDocumentId, userId);
        if (!parent || parent.isArchived) {
          return `父笔记 ${parentDocumentId} 不存在、已归档或无权访问，无法在其下创建子笔记。`;
        }
        parentTitle = parent.title;
      }

      logger.tools.info("[createNote] 创建笔记", { title, contentLen: content.length, parentDocumentId });

      // 规范存储格式为 BlockNote JSON（无损）：模型输出 Markdown → 服务端转 blocks（生成真实块 ID）
      // 正文开头的 # 一级标题作为文档 title（AI 的 title 参数可能为空或与正文不一致）
      const finalTitle = extractMarkdownTitle(content) || title;
      const blocks = await toBlocks(content);

      // 本地库插入草稿（isDraft=true 与 PG 版语义一致；content 为 BlockNote JSON）
      const docId = createDocument(db, userId, finalTitle, parentDocumentId ?? null);
      updateDocument(db, userId, docId, { content: JSON.stringify(blocks), isDraft: true });

      createdNoteId = docId;
      // 副作用通过 onEvent 上报：note_created 驱动前端跳转，reference 在流结束时汇总展示胶囊
      onEvent({ type: "note_created", noteId: docId, title: finalTitle, parentTitle });
      onEvent({ type: "reference", noteId: docId, title: finalTitle });
      logger.tools.info("[createNote] 已创建", { noteId: docId, title: finalTitle });

      return `笔记「${finalTitle}」已创建（ID: ${docId}），内容已写入。如果觉得内容需要调整，可用此 ID 调用 updateNote 修改。`;
    },
  });
}
