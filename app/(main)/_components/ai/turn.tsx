"use client";

// 单个回合（turn）渲染：用户气泡 + AI 工具卡片序列 + 文档副作用卡片 + 叙述文本 + 引用 + 回合 footer。
import { useEffect, useState } from "react";
import { MarkdownText } from "@/components/markdown/MarkdownText";
import { truncateMentionTitle } from "@/lib/mention";
import { cn } from "@/lib/utils";
import type { Question, TodoItem, Turn } from "./types";
import { formatDuration } from "./types";
import { ToolCard } from "./tool-card";
import { NoteCard } from "./note-card";

interface TurnProps {
  turn: Turn;
  onOpenDocument: (id: string) => void;
  onConfirmDelete: (noteId: string, title: string) => void;
  onCancelDelete: (noteId: string) => void;
  onConfirmMove: (noteId: string, title: string, parentDocument: string | null) => void;
  onCancelMove: (noteId: string) => void;
  onAnswerQuestion: (question: string, answers: string[], customText?: string) => void;
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

/** 任务清单卡片（对齐 SiYuan todo_write：多步任务进度跟踪） */
function TodoCard({ items }: { items: TodoItem[] }) {
  const statusLabel: Record<TodoItem["status"], string> = {
    pending: "待办",
    in_progress: "进行中",
    completed: "已完成",
    cancelled: "已取消",
  };
  return (
    <div className="rounded-xl border border-shell-border-l2 bg-shell-row-hover/50 px-3 py-2">
      <p className="mb-1.5 text-xs font-medium text-shell-label-secondary">任务清单</p>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 text-[13px] leading-5">
            <span
              className={cn(
                "flex h-4 w-4 flex-none items-center justify-center rounded border text-[9px] font-semibold",
                item.status === "completed" && "border-shell-accent/40 bg-shell-accent/10 text-shell-accent",
                item.status === "in_progress" && "border-shell-accent/40 text-shell-accent",
                item.status === "pending" && "border-shell-border-l2 text-transparent",
                item.status === "cancelled" && "border-shell-border-l2 text-shell-label-tertiary line-through",
              )}
            >
              {item.status === "completed" ? "✓" : item.status === "cancelled" ? "✕" : ""}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1",
                item.status === "completed" && "text-shell-label-tertiary line-through",
                item.status === "cancelled" && "text-shell-label-tertiary line-through",
              )}
            >
              {item.content}
            </span>
            <span
              className={cn(
                "flex-none text-[10px] leading-4",
                item.status === "in_progress" && "text-shell-accent",
                item.status === "completed" && "text-shell-label-tertiary",
                item.status === "pending" && "text-shell-label-caption",
                item.status === "cancelled" && "text-shell-label-caption",
              )}
            >
              {statusLabel[item.status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 结构化提问卡片（对齐 SiYuan question 工具：选项按钮，回答回传为新消息） */
function QuestionCard({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (question: string, answers: string[], customText?: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const toggle = (label: string) => {
    setSelected((prev) =>
      question.multiple
        ? prev.includes(label)
          ? prev.filter((x) => x !== label)
          : [...prev, label]
        : prev.includes(label)
          ? []
          : [label],
    );
  };
  const submit = () => onAnswer(question.question, selected, question.custom === false ? undefined : custom);

  return (
    <div className="rounded-xl border border-shell-border-l2 bg-shell-row-hover/50 px-3 py-2.5">
      <p className="text-sm font-medium leading-6 text-shell-label-primary">{question.question}</p>
      <p className="mb-2 text-xs text-shell-label-tertiary">{question.header}</p>
      <div className="flex flex-col gap-1.5">
        {question.options.map((opt) => {
          const active = selected.includes(opt.label);
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => toggle(opt.label)}
              className={cn(
                "cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors",
                active
                  ? "border-shell-accent/60 bg-shell-accent/10"
                  : "border-shell-border-l2 hover:bg-shell-row-active",
              )}
            >
              <span className="block text-[13px] font-medium leading-5 text-shell-label-primary">{opt.label}</span>
              <span className="block text-xs leading-4 text-shell-label-tertiary">{opt.description}</span>
            </button>
          );
        })}
        {question.custom !== false && (
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="自定义回答（可选）"
            className="h-8 rounded-lg border border-shell-border-l2 bg-transparent px-2.5 text-[13px] text-shell-label-primary outline-none placeholder:text-shell-label-caption focus:border-shell-accent/50"
          />
        )}
      </div>
      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          onClick={submit}
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg bg-shell-accent px-3 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          提交回答
        </button>
      </div>
    </div>
  );
}

export function TurnView({ turn, onOpenDocument, onConfirmDelete, onCancelDelete, onConfirmMove, onCancelMove, onAnswerQuestion }: TurnProps) {
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

        {/* 会话任务清单（todo_write） */}
        {turn.todos.length > 0 && <TodoCard items={turn.todos} />}

        {/* 结构化提问（askUser） */}
        {turn.questions.map((q, i) => (
          <QuestionCard key={i} question={q} onAnswer={onAnswerQuestion} />
        ))}

        {/* 文档副作用卡片 */}
        {turn.notes.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {turn.notes
              .filter((n) => !(n.kind === "delete_confirm" && n.resolved) && !(n.kind === "move_confirm" && n.resolved))
              .map((note, i) => (
                <NoteCard
                  key={i}
                  note={note}
                  onOpen={onOpenDocument}
                  onConfirmDelete={onConfirmDelete}
                  onCancelDelete={onCancelDelete}
                  onConfirmMove={onConfirmMove}
                  onCancelMove={onCancelMove}
                />
              ))}
          </div>
        )}

        {/* 叙述文本：DSH 对齐 markdown（md-content 样式由 markdown.css 提供，流式增量渲染） */}
        {(turn.text || turn.status === "running") && (
          <div className={cn("text-[15px] leading-6 text-shell-label-primary")}>
            {turn.text ? (
              <MarkdownText
                text={turn.text}
                streaming={turn.status === "running"}
                onOpenDocument={onOpenDocument}
              />
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