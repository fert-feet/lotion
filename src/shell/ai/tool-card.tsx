"use client";

// 工具调用卡片（对齐 DSH GenericCommandCard）：
// 行式（chevron + 图标 + 名称 + 分隔点 + 摘要）；running 时 300px 流光扫过；
// 点击展开参数正文（mono 代码块）与失败原因。
// 图标来自 lib/tool-meta.ts（与服务端 TOOL_META 同源，19 个工具不再退化成 ⚙️）。
import { useState } from "react";
import { ChevronRight } from "@/components/icons";
import { toolIcon } from "@/lib/tool-meta";
import { cn } from "@/lib/utils";
import type { ToolCardState } from "./types";

export function ToolCard({ card }: { card: ToolCardState }) {
  const [open, setOpen] = useState(false);
  const running = card.state === "running";
  const failed = card.state === "error";

  return (
    <div className="overflow-hidden rounded-xl" data-tool-state={card.state}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`工具调用 ${card.label}：${running ? "执行中" : failed ? "失败" : "完成"}`}
        className={cn(
          "group/tool relative flex w-full items-center gap-2 overflow-hidden rounded-xl px-3 py-2 text-left",
          "hover:bg-shell-row-hover",
          running && "tool-row-running"
        )}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 flex-none text-shell-label-secondary transition-transform duration-150 ease-[var(--ds-ease-in-out)]", open && "rotate-90")} />
        <span className="flex-none text-[15px] leading-none" aria-hidden="true">{toolIcon(card.tool)}</span>
        <span className="flex-none text-[13px] font-medium text-shell-label-primary">{card.label}</span>
        <span className="h-0.5 w-0.5 flex-none rounded-full bg-shell-label-caption" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] leading-5",
            failed ? "text-destructive" : "text-shell-label-tertiary"
          )}
        >
          {running ? "执行中…" : card.summary || (failed ? "执行失败" : "完成")}
        </span>
      </button>
      {open && (
        <div className="mx-3 mb-2 flex max-h-64 flex-col gap-2 overflow-auto rounded-lg border border-shell-border bg-shell-row-active/60 p-3">
          {card.argsText && (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-shell-label-primary">{card.argsText}</pre>
          )}
          {failed && card.error && (
            <div className="rounded-md bg-destructive/10 px-2 py-1.5">
              <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">错误</p>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-destructive">{card.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
