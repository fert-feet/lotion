"use client";

// 页面大纲（对标 Notion 右侧 Outline）：从编辑器文档提取标题层级，
// 点击跳转到对应块。固定在右侧，仅宽屏显示（AI 面板滑出时被覆盖属预期）。
import { useState } from "react";
import { useEditorChange } from "@blocknote/react";

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
    <aside className="fixed right-6 top-1/2 -translate-y-1/2 hidden xl:block w-52 max-h-[55vh] overflow-y-auto py-2 pl-2 pr-3 border-l border-shell-border">
      <div className="text-xs font-semibold text-shell-label-caption mb-2 tracking-wide">本页大纲</div>
      <nav className="space-y-px">
        {headings.map((h) => (
          <button
            key={h.id}
            onClick={() => editor.setTextCursorPosition(h.id, "start")}
            style={{ paddingLeft: 4 + (h.level - 1) * 12 }}
            className="block w-full text-left text-[13px] leading-5 py-1 pr-2 rounded-md text-shell-label-secondary hover:bg-shell-row-hover hover:text-shell-label-primary transition-colors truncate"
            title={h.text}
          >
            {h.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}
