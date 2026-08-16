"use client";

// 工具调用卡片（对齐 DSH GenericCommandCard）：
// 行式（chevron + 图标 + 名称 + 分隔点 + 摘要）；running 时 300px 流光扫过；
// 点击展开参数正文（mono 代码块）。
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCardState } from "./types";

/** 工具图标（前端本地映射，避免引入服务端模块） */
export const TOOL_ICONS: Record<string, string> = {
  searchNotes: "🔍",
  readNote: "📖",
  createNote: "✍️",
  updateNote: "📝",
  renameNote: "🏷️",
  archiveNote: "📦",
  deleteNote: "🗑️",
};

export function ToolCard({ card }: { card: ToolCardState }) {
  const [open, setOpen] = useState(false);
  const running = card.state === "running";

  return (
    <div className="overflow-hidden rounded-xl" data-tool-state={card.state}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "group/tool relative flex w-full items-center gap-2 overflow-hidden rounded-xl px-3 py-2 text-left",
          "hover:bg-shell-row-hover",
          running && "tool-row-running"
        )}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 flex-none text-shell-label-secondary transition-transform duration-150 ease-[var(--ds-ease-in-out)]", open && "rotate-90")} />
        <span className="flex-none text-[15px] leading-none">{TOOL_ICONS[card.tool] ?? "⚙️"}</span>
        <span className="flex-none text-[13px] font-medium text-shell-label-primary">{card.label}</span>
        <span className="h-0.5 w-0.5 flex-none rounded-full bg-shell-label-caption" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] leading-5",
            card.state === "error" ? "text-destructive" : "text-shell-label-tertiary"
          )}
        >
          {running ? "执行中…" : card.summary || "完成"}
        </span>
      </button>
      {open && (
        <div className="mx-3 mb-2 max-h-64 overflow-auto rounded-lg border border-shell-border bg-shell-row-active/60 p-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-shell-label-primary">{card.argsText}</pre>
        </div>
      )}
    </div>
  );
}
