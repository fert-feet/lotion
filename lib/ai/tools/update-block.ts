import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { updateDocument } from "@/lib/local/db";
import {
  blockText,
  ensureDocBlocks,
  flattenBlocks,
  kindLabel,
  NO_CONTENT_BLOCK_TYPES,
} from "./blocks-util";
import type { ToolEvent } from "./index";

export function createUpdateBlockTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description:
      "精确更新笔记中的单个块（对齐 BlockNote block.update）：按块 ID（getDocBlocks 返回的 ID）或块序号定位，替换该块文本，其余内容原样保留（块 ID 不变）。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID"),
      blockId: z
        .string()
        .optional()
        .describe("块 ID（getDocBlocks 返回的 ID）；与 index 二选一，优先 blockId"),
      index: z
        .number()
        .optional()
        .describe("块序号（getDocBlocks 返回的 [N]，含嵌套如 1.1）；与 blockId 二选一"),
      content: z.string().describe("新的块文本（行文本；代码块则为完整代码内容）"),
    }),
    execute: async ({
      noteId,
      blockId,
      index,
      content,
    }: {
      noteId: string;
      blockId?: string;
      index?: number;
      content?: string;
    }) => {
      logger.tools.info("[updateBlock] 更新块", { noteId, blockId, index, contentLen: content?.length ?? 0 });

      // 规范存储为 BlockNote JSON；存量 Markdown 惰性转换并写回（块 ID 持久化）
      const ensured = await ensureDocBlocks(db, userId, noteId);
      if (!ensured) {
        return `笔记 ${noteId} 不存在或无权修改。`;
      }
      const { blocks, title } = ensured;
      const flat = flattenBlocks(blocks);

      let targetIndex = -1;
      if (blockId) {
        targetIndex = flat.findIndex(({ block }) => block.id === blockId);
        if (targetIndex === -1) {
          return `未找到 ID 为 ${blockId} 的块。可先用 getDocBlocks 查看该笔记的块 ID。`;
        }
      } else if (typeof index === "number") {
        if (index < 0 || index >= flat.length) {
          return `块序号 ${index} 超出范围（共 ${flat.length} 块）。可先用 getDocBlocks 查看。`;
        }
        targetIndex = index;
      } else {
        return "必须提供 blockId 或 index 之一。";
      }

      const target = flat[targetIndex].block;
      if (target.type && NO_CONTENT_BLOCK_TYPES.has(target.type)) {
        return `第 ${targetIndex} 块是${kindLabel(target.type)}，不支持内容更新。`;
      }

      const newText = content ?? "";
      // 行内块 → inline content 数组；codeBlock → 纯字符串
      target.content =
        target.type === "codeBlock" ? newText : [{ type: "text", text: newText, styles: {} }];
      updateDocument(db, noteId, { content: JSON.stringify(blocks) });

      // 副作用：note_modified 驱动前端刷新，reference 流结束时汇总
      onEvent({ type: "note_modified", noteId, title });
      onEvent({ type: "reference", noteId, title });
      logger.tools.info("[updateBlock] 已更新", { noteId, targetIndex, blockId: blockId ?? null });
      const snippet = blockText(target).replace(/\n/g, " ").slice(0, 30);
      return `已更新笔记「${title}」第 ${targetIndex} 块${snippet ? `（原「${snippet}${blockText(target).length > 30 ? "..." : ""}」）` : ""}。`;
    },
  });
}
