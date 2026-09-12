"use client";

// 页面大纲（对标 Notion 右侧 Outline）：从编辑器文档提取标题层级，
// 点击跳转到对应块。
//
// 定位：绝对定位，基准是 AppShell 的「编辑器列」（CenterColumn 带 relative + @container），
// 不再是相对视口的 fixed —— 否则打开 AI 面板后大纲会浮在 AI 面板内容之上（曾出现表格被压住）。
// 编辑器列的 overflow-hidden 还会把大纲裁在列内，永远不会越界到 AI 面板。
//
// 可见性：容器查询按「编辑器列宽度」（而非视口宽度）判定。正文在列内居中，列宽不足以在
// 正文右侧留出 OUTLINE_GUTTER 时隐藏，因此大纲永不覆盖正文，也不会在窄列里挤成一片。
// 阈值 = lib/layout/columns.ts 的 outlineMinCenter()（1360px），由单测钉住。
import { useState } from "react";
import { useEditorChange } from "@blocknote/react";
import { cn } from "@/lib/utils";

// Tailwind 需要字面量类名才能生成对应工具类：
// @min-[1360px] = outlineMinCenter()，容器 = AppShell 的 CenterColumn（带 @container）。
const VISIBILITY_CLASS = "hidden @min-[1360px]:block";

/** 标题项最小形状（宽松，容忍任意 schema） */
interface HeadingItem {
  id: string;
  level: number;
  text: string;
}

interface LooseBlock {
  id?: string;
  type?: string;
  props?: { level?: number };
  content?: unknown;
  children?: LooseBlock[];
}

/** 遍历块树收集标题（含嵌套 children） */
function collectHeadings(document: readonly LooseBlock[]): HeadingItem[] {
  const out: HeadingItem[] = [];
  const walk = (blocks: readonly LooseBlock[]) => {
    for (const b of blocks) {
      if (b.type === "heading" && b.id) {
        const text = Array.isArray(b.content)
          ? (b.content as Array<{ text?: string }>)
              .map((c) => c.text ?? "")
              .join("")
              .trim()
          : "";
        if (text) out.push({ id: b.id, level: b.props?.level ?? 1, text });
      }
      if (b.children?.length) walk(b.children);
    }
  };
  walk(document);
  return out;
}

export default function OutlinePanel({
  editor,
}: {
  editor: { document: unknown; setTextCursorPosition: (id: string, placement?: "start" | "end") => void };
}) {
  const [headings, setHeadings] = useState<HeadingItem[]>(() =>
    collectHeadings(editor.document as readonly LooseBlock[]),
  );

  useEditorChange(
    (e) => {
      setHeadings(collectHeadings(((e as { document: unknown }).document) as readonly LooseBlock[]));
    },
    editor as never,
  );

  if (headings.length === 0) return null;

  return (
    <aside
      className={cn(
        "absolute right-6 top-1/2 w-52 max-h-[55vh] -translate-y-1/2 overflow-y-auto border-l border-shell-border py-2 pl-2 pr-3",
        VISIBILITY_CLASS,
      )}
    >
      <div className="mb-2 px-2 text-[11px] font-semibold text-shell-label-tertiary">本页大纲</div>
      <nav className="space-y-px">
        {headings.map((h) => (
          <button
            key={h.id}
            onClick={() => editor.setTextCursorPosition(h.id, "start")}
            style={{ paddingLeft: 4 + (h.level - 1) * 12 }}
            className="block w-full truncate rounded-[5px] px-2 py-1 text-left text-[12px] leading-[18px] text-shell-label-secondary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary"
            title={h.text}
          >
            {h.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}
