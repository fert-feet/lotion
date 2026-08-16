"use client";

// 单个回合（turn）渲染：用户气泡 + AI 工具卡片序列 + 文档副作用卡片 + 叙述文本 + 引用 + 回合 footer。
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { truncateMentionTitle } from "@/lib/mention";
import { cn } from "@/lib/utils";
import type { Turn } from "./types";
import { formatDuration } from "./types";
import { ToolCard } from "./tool-card";
import { NoteCard } from "./note-card";

interface TurnProps {
  turn: Turn;
  onOpenDocument: (id: string) => void;
  onConfirmDelete: (noteId: string, title: string) => void;
  onCancelDelete: (noteId: string) => void;
}

/** 用户消息里的 [@标题](id) 提及 → 胶囊 */
export function renderMentions(text: string, onOpen: (id: string) => void) {
  const parts = text.split(/(\[@[^\]]+\]\([a-zA-Z0-9-]{3,64}\))/g);
  return parts.map((part, index) => {
    const m = part.match(/^\[@([^\]]+)\]\(([a-zA-Z0-9-]{3,64})\)$/);
    if (m) {
      return (
        <button
          key={index}
          type="button"
          title={m[2]}
          onClick={() => onOpen(m[2])}
          className="mention-chip cursor-pointer"
        >
          <span>{"@" + truncateMentionTitle(m[1])}</span>
        </button>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

/** 运行中回合的实时时钟（对齐 DSH TurnStatus：15s 后才显示） */
function RunningClock({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  useEffect(() => {
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <div className="flex items-center gap-2 text-xs leading-[18px] text-shell-label-tertiary" role="status" aria-live="polite">
      <span className="h-1.5 w-1.5 rounded-full bg-shell-accent animate-pulse" />
      <span>正在思考</span>
      {elapsed >= 15000 && <span className="tabular-nums">· {formatDuration(elapsed)}</span>}
    </div>
  );
}

export function TurnView({ turn, onOpenDocument, onConfirmDelete, onCancelDelete }: TurnProps) {
  return (
    <div className="flex flex-col gap-2.5">
      {/* 用户气泡：DSH 22px 圆角专用色 */}
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[22px] bg-ai-muted px-4 py-2.5 text-[15px] leading-6 text-shell-label-primary">
          {renderMentions(turn.userContent, onOpenDocument)}
        </div>
      </div>

      {/* AI 回合内容 */}
      <div className="flex flex-col gap-2">
        {/* 工具调用卡片序列（按 seq 稳定排序） */}
        {turn.tools.length > 0 && (
          <div className="flex flex-col gap-1">
            {turn.tools.map((card) => <ToolCard key={card.seq} card={card} />)}
          </div>
        )}

        {/* 文档副作用卡片 */}
        {turn.notes.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {turn.notes.filter((n) => !(n.kind === "delete_confirm" && n.resolved)).map((note, i) => (
              <NoteCard
                key={i}
                note={note}
                onOpen={onOpenDocument}
                onConfirmDelete={onConfirmDelete}
                onCancelDelete={onCancelDelete}
              />
            ))}
          </div>
        )}

        {/* 叙述文本：DSH 全宽平铺 markdown */}
        {(turn.text || turn.status === "running") && (
          <div className={cn("prose prose-sm dark:prose-invert max-w-none text-[15px] leading-6 text-shell-label-primary prose-headings:my-1.5 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-code:bg-shell-row-active prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-shell-row-active prose-pre:text-xs")}>
            {turn.text ? (
              <ReactMarkdown
                components={{
                  a: ({ href, children }) => {
                    const text = Array.isArray(children)
                      ? children.map(String).join("")
                      : String(children ?? "");
                    if (text.startsWith("@") && href && /^[a-zA-Z0-9-]{3,64}$/.test(href)) {
                      return (
                        <button
                          type="button"
                          title={href}
                          onClick={() => onOpenDocument(href)}
                          className="mention-chip cursor-pointer"
                        >
                          <span>{"@" + truncateMentionTitle(text.slice(1))}</span>
                        </button>
                      );
                    }
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-foreground underline">
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {turn.text}
              </ReactMarkdown>
            ) : turn.status === "running" ? (
              <RunningClock startedAt={turn.createdAt} />
            ) : null}
          </div>
        )}

        {/* 引用 chips：AI 读取/涉及的笔记 */}
        {turn.references.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {turn.references.map((ref) => (
              <button
                key={ref.noteId}
                type="button"
                onClick={() => onOpenDocument(ref.noteId)}
                className="inline-flex max-w-[240px] cursor-pointer items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--shell-accent)_18%,transparent)] px-2.5 py-1 text-xs text-shell-label-primary transition-colors hover:bg-[color-mix(in_srgb,var(--shell-accent)_28%,transparent)]"
              >
                <span className="shrink-0">📄</span>
                <span className="truncate">{ref.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* 回合 footer：耗时 / token（对齐 DSH TurnTail） */}
        {turn.status === "done" && turn.durationMs !== null && (
          <div className="flex items-center gap-1 pt-0.5 text-[11px] leading-[16px] text-shell-label-caption">
            <span>耗时 {formatDuration(turn.durationMs)}</span>
            {turn.tokens !== null && (
              <>
                <span className="h-0.5 w-0.5 rounded-full bg-shell-label-caption" />
                <span>输出 {turn.tokens.output.toLocaleString()} tokens</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}