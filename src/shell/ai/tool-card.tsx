"use client";

// 工具调用卡片 —— 紧凑的"活动行"（不是满宽 hover 行）。
//
// 重构要点（对齐 Apple 的 Activity / 状态行语言）：
//   * 前置是工具自己的字形（来自 lib/tool-meta.ts），一眼看出"发生了什么"；
//   * 尾部是状态位：执行中是呼吸的 AI 渐变点，完成后变成展开箭头 ——
//     同一个位置承载"进行中"与"可展开"，不再额外占一列；
//   * 默认透明、hover 才浮出底色，所以一串连续调用读起来是一条安静的日志，
//     而不是一堆互相抢注意力的按钮；
//   * 运行中的光效换成 .ai-running-row（柔和、无硬边），替换原 300px 色块扫过。
import { useState } from "react";
import { ChevronRight } from "@/components/icons";
import { toolIcon } from "@/lib/tool-meta";
import { cn } from "@/lib/utils";
import { AiDot } from "./ai-mark";
import type { ToolCardState } from "./types";

export function ToolCard({ card }: { card: ToolCardState }) {
  const [open, setOpen] = useState(false);
  const running = card.state === "running";
  const failed = card.state === "error";

  return (
    <div data-tool-state={card.state}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`工具调用 ${card.label}：${running ? "执行中" : failed ? "失败" : "完成"}`}
        className={cn(
          "relative flex w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg py-1 pl-2 pr-1.5 text-left",
          "transition-colors duration-150 ease-[var(--ds-ease-out)] hover:bg-shell-row-hover",
          running && "ai-running-row",
        )}
      >
        <span className="flex-none text-[14px] leading-none" aria-hidden="true">{toolIcon(card.tool)}</span>
        <span className="flex-none text-[13px] font-medium text-shell-label-primary">{card.label}</span>
        <span className="h-0.5 w-0.5 flex-none rounded-full bg-shell-label-caption" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12px] leading-5",
            failed ? "text-destructive" : "text-shell-label-tertiary",
          )}
        >
          {running ? "执行中…" : card.summary || (failed ? "执行失败" : "完成")}
        </span>
        {/* 状态位：执行中＝呼吸的渐变点；完成后＝展开箭头（同一位置，不额外占列） */}
        {running ? (
          <AiDot size={7} running className="ml-1" />
        ) : (
          <ChevronRight
            className={cn(
              "h-3 w-3 flex-none text-shell-label-tertiary transition-transform duration-150 ease-[var(--ds-ease-in-out)]",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {open && (
        <div className="mx-2 mb-1.5 flex max-h-64 flex-col gap-2 overflow-auto rounded-lg border-[0.5px] border-shell-border bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] p-2.5">
          {card.argsText && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-shell-label-secondary">{card.argsText}</pre>
          )}
          {failed && card.error && (
            <div className="rounded-md bg-destructive/10 px-2 py-1.5">
              <p className="mb-0.5 text-[11px] font-medium text-destructive">错误</p>
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-destructive">{card.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
