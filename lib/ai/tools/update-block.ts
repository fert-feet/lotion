import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import { toMarkdown } from "@/lib/content";
import { parseEditableBlocks } from "@/lib/editor/blocks";
import { replaceBlockText } from "@/lib/editor/ops";
import { getDocumentById, updateDocument } from "@/lib/local/db";
import type { ToolEvent } from "./index";

export function createUpdateBlockTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description:
      "精确更新笔记中的单个块（对齐 SiYuan block.update）：按锚点 ID（getDocBlocks 返回的 {#id}）或块序号定位，替换该块文本，其余内容原样保留。锚点块更新后锚点自动保留。",
    inputSchema: z.object({
      noteId: z.string().describe("笔记 ID"),
      anchor: z.string().optional().describe("块锚点 ID（getDocBlocks 返回，去掉 {#} 包裹）；与 index 二选一，优先 anchor"),
      index: z.number().optional().describe("块序号（getDocBlocks 返回的 [N]）；与 anchor 二选一"),
      content: z.string().describe("新的块文本（行文本；代码块则为完整代码内容）"),
    }),
    execute: async ({ noteId, anchor, index, content }: { noteId: string; anchor?: string; index?: number; content?: string }) => {
      logger.tools.info("[updateBlock] 更新块", { noteId, anchor, index, contentLen: content?.length ?? 0 });

      const doc = getDocumentById(db, noteId, userId);
      if (!doc) {
        return `笔记 ${noteId} 不存在或无权修改。`;
      }

      const blocks = parseEditableBlocks(toMarkdown(doc.content));
      let targetIndex = -1;
      if (anchor) {
        targetIndex = blocks.findIndex((b) => b.meta.anchor === anchor);
        if (targetIndex === -1) {
          return `未找到锚点 {#${anchor}} 对应的块。可先用 getDocBlocks 查看该笔记的锚点。`;
        }
      } else if (typeof index === "number") {
        if (index < 0 || index >= blocks.length) {
          return `块序号 ${index} 超出范围（共 ${blocks.length} 块）。可先用 getDocBlocks 查看。`;
        }
        targetIndex = index;
      } else {
        return "必须提供 anchor 或 index 之一。";
      }

      const target = blocks[targetIndex];
      if (target.kind === "divider" || target.kind === "table") {
        return `第 ${targetIndex} 块是${target.kind === "divider" ? "分隔线" : "表格"}，不支持内容更新。`;
      }

      const newText = content ?? "";
      const result = replaceBlockText(toMarkdown(doc.content), targetIndex, newText);
      updateDocument(db, noteId, { content: result.markdown });

      // 副作用：note_modified 驱动前端刷新，reference 流结束时汇总
      onEvent({ type: "note_modified", noteId, title: doc.title });
      onEvent({ type: "reference", noteId, title: doc.title });
      logger.tools.info("[updateBlock] 已更新", { noteId, targetIndex, anchor: anchor ?? null });
      const snippet = target.text.replace(/\n/g, " ").slice(0, 30);
      return `已更新笔记「${doc.title}」第 ${targetIndex} 块${snippet ? `（原「${snippet}${target.text.length > 30 ? "..." : ""}」）` : ""}。`;
    },
  });
}
