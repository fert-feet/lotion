import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { toMarkdown } from "@/lib/content";
import { parseEditableBlocks } from "@/lib/editor/blocks";
import { getDocumentById } from "@/lib/local/db";

/** 块摘要长度 */
const SNIPPET_CHAR_LIMIT = 60;

/** 块类型中文标签（getDocBlocks 输出用） */
const KIND_LABELS: Record<string, string> = {
  paragraph: "段落",
  heading: "标题",
  bullet: "无序项",
  numbered: "有序项",
  todo: "任务项",
  quote: "引用",
  code: "代码块",
  divider: "分隔线",
  table: "表格",
};

export function createGetDocBlocksTool(db: Database.Database, userId: string) {
  return tool({
    description:
      "列出笔记的块清单（对齐 SiYuan 块模型）：每个块的序号、类型、锚点 ID（{#id}，若有）与文本摘要。用于精确定位块（配合 updateBlock 按序号或锚点更新）。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID"),
    }),
    execute: async ({ noteId }: { noteId: string }) => {
      logger.tools.info("[getDocBlocks] 列出块", { noteId });
      const doc = getDocumentById(db, noteId, userId);
      if (!doc) {
        return `笔记 ${noteId} 不存在或无权访问。`;
      }

      const blocks = parseEditableBlocks(toMarkdown(doc.content));
      if (blocks.length === 1 && blocks[0].text === "") {
        return `笔记「${doc.title}」是空文档。`;
      }

      const lines = blocks.map((b) => {
        const kind = KIND_LABELS[b.kind] ?? b.kind;
        const anchor = b.meta.anchor ? ` 锚点: {#${b.meta.anchor}}` : "";
        const snippet = b.text.replace(/\n/g, " ").slice(0, SNIPPET_CHAR_LIMIT);
        const text = snippet ? ` 内容: ${snippet}${b.text.length > SNIPPET_CHAR_LIMIT ? "..." : ""}` : "";
        return `[${b.index}] (${kind})${anchor}${text}`;
      });

      return `笔记「${doc.title}」共 ${blocks.length} 块：\n${lines.join("\n")}`;
    },
  });
}
