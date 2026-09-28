"use client";

// 单个回合（turn）渲染：用户气泡 + **按事件顺序**的时间线（叙述/工具卡/副作用卡/待办/提问/警告）
// + 引用 chips + 回合 footer（耗时 / token / 失败重试）。
// 旧实现把工具卡固定堆在叙述上方，文本→工具→文本的交错顺序会丢；现在按 turn.parts 顺序渲染。
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, FileText, Loader2, PenLine, Plus, RefreshCw, Undo } from "@/components/icons";
import { MarkdownText } from "@/components/markdown/MarkdownText";
import { truncateMentionTitle } from "@/lib/mention";
import { cn } from "@/lib/utils";
import type { Question, TodoItem, Turn } from "./types";
import { formatDuration } from "./types";
import { ToolCard } from "./tool-card";
import { NoteCard } from "./note-card";

type ConfirmResult = void | Promise<unknown>;

interface TurnProps {
  turn: Turn;
  onOpenDocument: (id: string) => void;
  onConfirmDelete: (noteId: string, title: string) => ConfirmResult;
  onCancelDelete: (noteId: string) => void;
  onConfirmMove: (noteId: string, title: string, parentDocument: string | null) => ConfirmResult;
  onCancelMove: (noteId: string) => void;
  onAnswerQuestion: (
    turnId: string,
    index: number,
    question: Question,
    answers: string[],
    customText?: string,
  ) => void;
  onRetry: (turn: Turn) => void;
  /** 撤销本轮 AI 对文档的改动 */
  onUndo: (turn: Turn) => void;
  /** 编辑重发：把该轮用户输入回填到输入框 */
  onEditUser: (turn: Turn) => void;
  /** 把该轮回答追加到当前文档（没有打开文档时按钮不显示） */
  onInsertToDocument: (turn: Turn) => void;
  /** 把该轮回答另存为一篇新笔记 */
  onSaveAsNote: (turn: Turn) => void;
  /** 当前是否打开了文档（决定是否显示「插入本文档」） */
  canInsertToDocument: boolean;
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
    <div className="rounded-[10px] border-[0.5px] border-shell-border-l2 bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] px-3 py-2">
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

/** 结构化提问卡片（对齐 SiYuan question 工具：选项按钮，回答回传为新消息；答过即只读） */
function QuestionCard({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (answers: string[], customText?: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (question.answered) {
    return (
      <div className="flex items-start gap-2 rounded-[10px] border-[0.5px] border-shell-border-l2 bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] px-3 py-2">
        <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-shell-accent" />
        <div className="min-w-0">
          <p className="text-xs leading-5 text-shell-label-tertiary">{question.question}</p>
          <p className="text-[13px] leading-5 text-shell-label-primary">{question.answered}</p>
        </div>
      </div>
    );
  }

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
  const submit = () => {
    setSubmitting(true);
    onAnswer(selected, question.custom === false ? undefined : custom);
  };

  return (
    <div className="rounded-[10px] border-[0.5px] border-shell-border-l2 bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] px-3 py-2.5">
      <p className="text-sm font-medium leading-6 text-shell-label-primary">{question.question}</p>
      <p className="mb-2 text-xs text-shell-label-tertiary">{question.header}</p>
      <div className="flex flex-col gap-1.5">
        {question.options.map((opt) => {
          const active = selected.includes(opt.label);
          return (
            <button
              key={opt.label}
              type="button"
              disabled={submitting}
              onClick={() => toggle(opt.label)}
              className={cn(
                "cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-60",
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
            disabled={submitting}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="自定义回答（可选）"
            className="h-8 rounded-lg border border-shell-border-l2 bg-transparent px-2.5 text-[13px] text-shell-label-primary outline-none placeholder:text-shell-label-caption focus:border-shell-accent/50"
          />
        )}
      </div>
      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          disabled={submitting}
          onClick={submit}
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg bg-shell-accent px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          提交回答
        </button>
      </div>
    </div>
  );
}

/** 警告 / 失败卡：原来只有一闪而过的 toast，刷新后什么都不剩 */
function NoticeCard({ level, message, onRetry }: { level: "warning" | "error"; message: string; onRetry?: () => void }) {
  const danger = level === "error";
  return (
    <div
      role={danger ? "alert" : "status"}
      className={cn(
        "rounded-[10px] border-[0.5px] px-3 py-2.5",
        danger ? "border-destructive/25 bg-destructive/5" : "border-amber-500/25 bg-amber-500/5",
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 flex-none", danger ? "text-destructive" : "text-amber-500")} />
        <p className={cn("min-w-0 flex-1 text-[13px] leading-5", danger ? "text-destructive" : "text-shell-label-primary")}>
          {message}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex flex-none cursor-pointer items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <RefreshCw className="h-3 w-3" />
            重试
          </button>
        )}
      </div>
    </div>
  );
}

/** 回合级操作条（复制 / 重新生成 / 编辑重发 / 插入本文档 / 另存为笔记） */
function TurnActions({
  turn,
  canInsertToDocument,
  onRetry,
  onUndo,
  onEditUser,
  onInsertToDocument,
  onSaveAsNote,
}: {
  turn: Turn;
  canInsertToDocument: boolean;
  onRetry: (turn: Turn) => void;
  onUndo: (turn: Turn) => void;
  onEditUser: (turn: Turn) => void;
  onInsertToDocument: (turn: Turn) => void;
  onSaveAsNote: (turn: Turn) => void;
}) {
  const hasText = turn.text.trim().length > 0;
  const copy = useCallback(async () => {
    if (!hasText) return;
    try {
      await navigator.clipboard.writeText(turn.text);
      toast.success("已复制回答");
    } catch {
      toast.error("复制失败，请手动选择文本");
    }
  }, [hasText, turn.text]);

  const actionClass =
    "cursor-pointer rounded-md px-1.5 py-0.5 transition-colors hover:bg-shell-row-hover hover:text-shell-label-secondary";

  return (
    <span className="flex flex-wrap items-center gap-1" data-turn-actions>
      {hasText && (
        <button type="button" onClick={copy} className={actionClass} title="复制回答">
          <span className="inline-flex items-center gap-1">
            <Copy className="h-3 w-3" />
            复制
          </span>
        </button>
      )}
      {turn.changedDocuments.length > 0 && turn.requestId && !turn.undone && (
        <button
          type="button"
          onClick={() => onUndo(turn)}
          className={actionClass}
          title={`恢复这轮改动前的文档（${turn.changedDocuments.length} 篇）`}
        >
          <span className="inline-flex items-center gap-1">
            <Undo className="h-3 w-3" />
            撤销本次改动
          </span>
        </button>
      )}
      {turn.undone && turn.changedDocuments.length > 0 && (
        <span className="px-1.5 py-0.5 text-shell-label-caption">已撤销本次改动</span>
      )}
      <button
        type="button"
        onClick={() => onRetry(turn)}
        className={actionClass}
        title="用同样的输入重新生成一轮"
      >
        <span className="inline-flex items-center gap-1">
          <RefreshCw className="h-3 w-3" />
          重新生成
        </span>
      </button>
      <button
        type="button"
        onClick={() => onEditUser(turn)}
        className={actionClass}
        title="把这条输入放回输入框再改一改"
      >
        <span className="inline-flex items-center gap-1">
          <PenLine className="h-3 w-3" />
          编辑重发
        </span>
      </button>
      {hasText && canInsertToDocument && (
        <button
          type="button"
          onClick={() => onInsertToDocument(turn)}
          className={actionClass}
          title="把回答追加到当前打开的文档末尾"
        >
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3 w-3" />
            插入本文档
          </span>
        </button>
      )}
      {hasText && (
        <button
          type="button"
          onClick={() => onSaveAsNote(turn)}
          className={actionClass}
          title="把回答另存为一篇新笔记"
        >
          <span className="inline-flex items-center gap-1">
            <Plus className="h-3 w-3" />
            另存为笔记
          </span>
        </button>
      )}
    </span>
  );
}

function TurnViewInner({ turn, onOpenDocument, onConfirmDelete, onCancelDelete, onConfirmMove, onCancelMove, onAnswerQuestion, onRetry, onUndo, onEditUser, onInsertToDocument, onSaveAsNote, canInsertToDocument }: TurnProps) {
  const running = turn.status === "running";
  const lastPartIndex = turn.parts.length - 1;
  const trailingText = turn.parts[lastPartIndex]?.kind === "text";

  return (
    <div className="flex flex-col gap-2.5">
      {/* 用户气泡：DSH 22px 圆角专用色（附件以 chip 呈现，正文不下发到界面） */}
      <div className="flex flex-col items-end gap-1">
        {turn.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {turn.attachments.map((item, index) => (
              <span
                key={item.name + index}
                title={`${item.name}（${item.size.toLocaleString()} 字）`}
                className="inline-flex max-w-[200px] items-center gap-1 rounded-[7px] border-[0.5px] border-shell-border-l2 px-2 py-0.5 text-[11px] text-shell-label-tertiary"
              >
                <FileText className="h-3 w-3 flex-none" />
                <span className="truncate">{item.name}</span>
              </span>
            ))}
          </div>
        )}
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] bg-ai-muted px-3.5 py-2 text-[14px] leading-[1.5] text-shell-label-primary">
          {renderMentions(turn.userContent, onOpenDocument)}
        </div>
      </div>

      {/* AI 回合内容：严格按事件顺序 */}
      <div className="flex flex-col gap-2">
        {turn.parts.map((part, i) => {
          switch (part.kind) {
            case "text":
              return (
                <div key={i} className="text-[14px] leading-[1.6] text-shell-label-primary">
                  <MarkdownText
                    text={part.text}
                    streaming={running && i === lastPartIndex}
                    onOpenDocument={onOpenDocument}
                  />
                </div>
              );
            case "tool": {
              const card = turn.tools.find((c) => c.seq === part.seq);
              return card ? <ToolCard key={i} card={card} /> : null;
            }
            case "note": {
              const note = turn.notes[part.index];
              if (!note) return null;
              return (
                <NoteCard
                  key={i}
                  note={note}
                  onOpen={onOpenDocument}
                  onConfirmDelete={onConfirmDelete}
                  onCancelDelete={onCancelDelete}
                  onConfirmMove={onConfirmMove}
                  onCancelMove={onCancelMove}
                />
              );
            }
            case "todo":
              return turn.todos.length > 0 ? <TodoCard key={i} items={turn.todos} /> : null;
            case "question": {
              const q = turn.questions[part.index];
              if (!q) return null;
              return (
                <QuestionCard
                  key={i}
                  question={q}
                  onAnswer={(answers, customText) => onAnswerQuestion(turn.id, part.index, q, answers, customText)}
                />
              );
            }
            case "warning": {
              const message = turn.warnings[part.index];
              return message ? <NoticeCard key={i} level="warning" message={message} /> : null;
            }
          }
        })}

        {/* 还没吐出任何文本时的思考指示 */}
        {running && !trailingText && <RunningClock startedAt={turn.createdAt} />}

        {/* 失败卡：错误事件或请求失败都走这里（原实现只有 toast，回合还一直转圈） */}
        {turn.status === "error" && (
          <NoticeCard
            level="error"
            message={turn.errorMessage || "生成失败，请重试"}
            onRetry={() => onRetry(turn)}
          />
        )}

        {/* 引用 chips：AI 读取/涉及的笔记 */}
        {turn.references.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {turn.references.map((ref) => (
              <button
                key={ref.noteId}
                type="button"
                onClick={() => onOpenDocument(ref.noteId)}
                className="inline-flex max-w-[240px] cursor-pointer items-center gap-1.5 rounded-[7px] bg-[color-mix(in_srgb,var(--shell-accent)_14%,transparent)] px-2.5 py-1 text-xs font-medium text-shell-accent transition-colors hover:bg-[color-mix(in_srgb,var(--shell-accent)_22%,transparent)]"
              >
                <span className="shrink-0">📄</span>
                <span className="truncate">{ref.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* 回合 footer：耗时 / token（对齐 DSH TurnTail）+ 回合级操作；失败回合由上方错误卡承载 */}
        {turn.status === "done" && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-[11px] leading-[16px] text-shell-label-caption">
            {turn.durationMs !== null && <span>耗时 {formatDuration(turn.durationMs)}</span>}
            {turn.tokens !== null && (
              <>
                {turn.durationMs !== null && <span className="h-0.5 w-0.5 rounded-full bg-shell-label-caption" />}
                <span>
                  {turn.tokens.input.toLocaleString()} in / {turn.tokens.output.toLocaleString()} out tokens
                </span>
              </>
            )}
            <TurnActions
              turn={turn}
              canInsertToDocument={canInsertToDocument}
              onRetry={onRetry}
              onUndo={onUndo}
              onEditUser={onEditUser}
              onInsertToDocument={onInsertToDocument}
              onSaveAsNote={onSaveAsNote}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** memo：流式期间每帧只应重渲"正在长的那一轮"，历史回合靠浅比较跳过 */
export const TurnView = memo(TurnViewInner);
