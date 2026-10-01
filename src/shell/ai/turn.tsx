"use client";

// 单个回合（turn）渲染：用户气泡 + **按事件顺序**的时间线（叙述/工具卡/副作用卡/待办/提问/警告）
// + 引用 chips + 回合 footer（详情披露 / 操作）。
// 旧实现把工具卡固定堆在叙述上方，文本→工具→文本的交错顺序会丢；现在按 turn.parts 顺序渲染。
//
// 视觉语言（混合模式，2026-09 重构）：
//   * 用户消息 = systemBlue 实底气泡、右对齐 —— 全局唯一的"实心彩色面"，
//     因此对话的来回关系一眼可读（此前用的是 AI 品牌黄，语义是反的）；
//   * 助手回答**不加气泡**，按正文排版（贴近 Siri / Apple Intelligence 的呈现），
//     它与卡片之间的区分靠留白与卡片自身的发丝边，而不是再套一层圆角容器；
//   * AI 的身份由 <AiOrb> 渐变承担，思考中是一个呼吸的渐变点；
//   * 耗时 / tokens 这类开发者元信息从常驻行收进 ⓘ 披露区，默认不抢注意力。
//
// ⚠️ 文案是契约：'正在思考' / '已创建草稿「X」' / '确认保存' / '丢弃' 等被
// test/components/ai/panel-streaming.test.tsx 直接断言，改字会破坏回归保护。
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, Copy, FileText, Info, Loader2, PenLine, Plus, RefreshCw, Square, Undo } from "@/components/icons";
import { MarkdownText } from "@/components/markdown/MarkdownText";
import { Button } from "@/components/ui/button";
import { truncateMentionTitle } from "@/lib/mention";
import { cn } from "@/lib/utils";
import type { AiChangePreview } from "@/lib/seams/doc-store";
import type { Question, TodoItem, Turn } from "./types";
import { formatDuration } from "./types";
import { ToolCard } from "./tool-card";
import { NoteCard } from "./note-card";
import { AiDot } from "./ai-mark";

type ConfirmResult = void | Promise<unknown>;

interface TurnProps {
  turn: Turn;
  onOpenDocument: (id: string) => void;
  onConfirmDelete: (noteId: string, title: string) => ConfirmResult;
  onCancelDelete: (noteId: string) => void;
  onConfirmMove: (noteId: string, title: string, parentDocument: string | null) => ConfirmResult;
  onCancelMove: (noteId: string) => void;
  /** AI 草稿确认（对话栏内完成） */
  onConfirmDraft: (noteId: string, title: string) => ConfirmResult;
  onDiscardDraft: (noteId: string, title: string) => ConfirmResult;
  onAnswerQuestion: (
    turnId: string,
    index: number,
    question: Question,
    answers: string[],
    customText?: string,
  ) => void;
  onRetry: (turn: Turn) => void;
  /** 停止本轮生成（用户点「停止」/「停止并开新对话」） */
  onStop: () => void;
  onStopAndNewSession: () => void;
  /** 撤销本轮 AI 对文档的改动 */
  onUndo: (turn: Turn) => void;
  /** 拉取本轮改动的改动前后对照（懒加载，点「查看改动」时才请求） */
  onPreviewChanges: (turn: Turn) => Promise<AiChangePreview[]>;
  /** 编辑重发：把该轮用户输入回填到输入框 */
  onEditUser: (turn: Turn) => void;
  /** 把该轮回答追加到当前文档（没有打开文档时按钮不显示） */
  onInsertToDocument: (turn: Turn) => void;
  /** 把该轮回答另存为一篇新笔记 */
  onSaveAsNote: (turn: Turn) => void;
  /** 当前是否打开了文档（决定是否显示「插入本文档」） */
  canInsertToDocument: boolean;
}

/**
 * 用户消息里的 [@标题](id) 提及 → 胶囊。
 * onAccent=true 时用反色胶囊：用户气泡是 systemBlue 实底，
 * 默认胶囊的"蓝底蓝字"落在它上面等于隐形。
 */
export function renderMentions(text: string, onOpen: (id: string) => void, onAccent = false) {
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
          className={cn("mention-chip cursor-pointer", onAccent && "mention-chip-on-accent")}
        >
          <span>{"@" + truncateMentionTitle(m[1])}</span>
        </button>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

/** 运行中回合的实时时钟（对齐 DSH TurnStatus：15s 后才显示）。⚠️「正在思考」是测试断言的字样。 */
function RunningClock({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  useEffect(() => {
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <div className="flex items-center gap-2 text-[12px] leading-[18px] text-shell-label-tertiary" role="status" aria-live="polite">
      <AiDot size={7} running />
      <span>正在思考</span>
      {elapsed >= 15000 && <span className="tabular-nums">· {formatDuration(elapsed)}</span>}
    </div>
  );
}

/** 回合内的停止操作：显式文字按钮（用户明确要求"点中断"要看得见，不做 hover 才现身） */
function StopActions({
  onStop,
  onStopAndNewSession,
}: {
  onStop: () => void;
  onStopAndNewSession: () => void;
}) {
  return (
    <span className="flex flex-none items-center gap-1" data-stop-actions>
      <Button variant="ghost" size="sm" onClick={onStop} className="text-shell-label-secondary">
        <Square className="h-2.5 w-2.5" />
        停止生成
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onStopAndNewSession}
        title="停止当前生成并开一个新对话"
        className="text-shell-label-tertiary"
      >
        <Plus className="h-3 w-3" />
        停止并开新对话
      </Button>
    </span>
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
    <div className="surface-card px-3 py-2.5">
      <p className="mb-2 text-[12px] font-medium text-shell-label-secondary">任务清单</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 text-[13px] leading-5">
            {/* 勾/叉是图标字形而非可读正文：16px 圆圈里 10px 才是正确视觉重量
                （"最小 11px"针对正文，不针对符号） */}
            <span
              className={cn(
                "flex h-4 w-4 flex-none items-center justify-center rounded-full border-[0.5px] text-[10px] font-semibold",
                item.status === "completed" && "border-success/40 bg-success/10 text-success",
                item.status === "in_progress" && "border-shell-accent/50 text-shell-accent",
                item.status === "pending" && "border-shell-border-l2 text-transparent",
                item.status === "cancelled" && "border-shell-border-l2 text-shell-label-tertiary",
              )}
            >
              {item.status === "completed" ? "✓" : item.status === "cancelled" ? "✕" : ""}
              {item.status === "in_progress" && <span className="h-1.5 w-1.5 rounded-full bg-shell-accent animate-pulse" />}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1",
                (item.status === "completed" || item.status === "cancelled") && "text-shell-label-tertiary line-through",
              )}
            >
              {item.content}
            </span>
            <span
              className={cn(
                "flex-none text-[11px] leading-4",
                item.status === "in_progress" && "text-shell-accent",
                item.status === "completed" && "text-success",
                (item.status === "pending" || item.status === "cancelled") && "text-shell-label-caption",
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
      <div className="surface-card flex items-start gap-2 px-3 py-2.5">
        <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-success" />
        <div className="min-w-0">
          <p className="text-[12px] leading-5 text-shell-label-tertiary">{question.question}</p>
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
    <div className="surface-card px-3.5 py-3">
      <p className="text-[14px] font-medium leading-6 text-shell-label-primary">{question.question}</p>
      {question.header && <p className="mb-2.5 mt-0.5 text-[12px] leading-4 text-shell-label-tertiary">{question.header}</p>}
      <div className={cn("flex flex-col gap-1.5", !question.header && "mt-2.5")}>
        {question.options.map((opt) => {
          const active = selected.includes(opt.label);
          return (
            <button
              key={opt.label}
              type="button"
              disabled={submitting}
              onClick={() => toggle(opt.label)}
              className={cn(
                "cursor-pointer rounded-md border-[0.5px] px-2.5 py-1.5 text-left transition-colors duration-150 ease-[var(--ds-ease-out)] disabled:cursor-default disabled:opacity-50",
                active
                  ? "border-shell-accent/50 bg-shell-accent/10"
                  : "border-shell-border-l2 hover:bg-shell-row-hover",
              )}
            >
              <span className="block text-[13px] font-medium leading-5 text-shell-label-primary">{opt.label}</span>
              {opt.description && (
                <span className="block text-[12px] leading-4 text-shell-label-tertiary">{opt.description}</span>
              )}
            </button>
          );
        })}
        {question.custom !== false && (
          <input
            value={custom}
            disabled={submitting}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="自定义回答（可选）"
            className="h-8 rounded-md border-[0.5px] border-shell-border-l2 bg-transparent px-2.5 text-[13px] text-shell-label-primary outline-none transition-colors placeholder:text-shell-label-caption focus:border-shell-accent/50"
          />
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={submitting} onClick={submit}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          提交回答
        </Button>
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
      className={cn("px-3 py-2.5", danger ? "surface-card-danger" : "surface-card-warning")}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 flex-none", danger ? "text-destructive" : "text-warning")} />
        <p className={cn("min-w-0 flex-1 text-[13px] leading-5", danger ? "text-destructive" : "text-shell-label-primary")}>
          {message}
        </p>
        {onRetry && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className={cn("-my-1 flex-none", danger ? "text-destructive hover:bg-destructive/10" : "text-shell-label-secondary")}
          >
            <RefreshCw className="h-3 w-3" />
            重试
          </Button>
        )}
      </div>
    </div>
  );
}

/** 回合级操作条（复制 / 撤销 / 查看改动 / 重新生成 / 编辑重发 / 插入本文档 / 另存为笔记） */
function TurnActions({
  turn,
  canInsertToDocument,
  onRetry,
  onUndo,
  onPreviewChanges,
  onEditUser,
  onInsertToDocument,
  onSaveAsNote,
}: {
  turn: Turn;
  canInsertToDocument: boolean;
  onRetry: (turn: Turn) => void;
  onUndo: (turn: Turn) => void;
  onPreviewChanges: (turn: Turn) => Promise<AiChangePreview[]>;
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
    "cursor-pointer rounded-sm px-1.5 py-0.5 text-[11px] text-shell-label-tertiary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary";

  const [preview, setPreview] = useState<AiChangePreview[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const togglePreview = useCallback(async () => {
    if (preview) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      setPreview(await onPreviewChanges(turn));
    } finally {
      setPreviewLoading(false);
    }
  }, [preview, onPreviewChanges, turn]);

  return (
    <>
      <span className="flex flex-wrap items-center gap-0.5" data-turn-actions>
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
        {turn.changedDocuments.length > 0 && !turn.undone && (
          <button
            type="button"
            onClick={() => void togglePreview()}
            className={actionClass}
            title="看看 AI 到底改了哪些内容"
          >
            <span className="inline-flex items-center gap-1">
              {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3" />}
              {preview ? "收起改动" : "查看改动"}
            </span>
          </button>
        )}
        {turn.undone && turn.changedDocuments.length > 0 && (
          <span className="px-1.5 py-0.5 text-[11px] text-shell-label-caption">已撤销本次改动</span>
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
      {preview && preview.length > 0 && (
        <div className="mt-1.5 w-full space-y-2 rounded-lg border-[0.5px] border-shell-border bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] p-2.5">
          {preview.map((change) => (
            <div key={change.documentId} className="space-y-1">
              <p className="text-[11px] font-medium text-shell-label-secondary">
                {change.beforeTitle === change.title
                  ? change.title
                  : `${change.beforeTitle} → ${change.title}`}
              </p>
              <div className="grid grid-cols-2 gap-2 text-[11px] leading-4">
                <div className="rounded-md bg-destructive/5 p-2">
                  <p className="mb-1 text-[11px] font-medium text-destructive">改动前</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-shell-label-secondary">
                    {change.before.trim() || "（空）"}
                  </pre>
                </div>
                <div className="rounded-md bg-shell-accent/5 p-2">
                  <p className="mb-1 text-[11px] font-medium text-shell-accent">改动后</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-shell-label-secondary">
                    {change.after.trim() || "（空）"}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TurnViewInner({ turn, onOpenDocument, onConfirmDelete, onCancelDelete, onConfirmMove, onCancelMove, onConfirmDraft, onDiscardDraft, onAnswerQuestion, onRetry, onStop, onStopAndNewSession, onUndo, onPreviewChanges, onEditUser, onInsertToDocument, onSaveAsNote, canInsertToDocument }: TurnProps) {
  const running = turn.status === "running";
  const lastPartIndex = turn.parts.length - 1;
  const trailingText = turn.parts[lastPartIndex]?.kind === "text";
  // 运行详情（耗时 / tokens）默认收起：这是开发者元信息，不该常驻抢注意力
  const [metaOpen, setMetaOpen] = useState(false);
  const hasMeta = turn.durationMs !== null || turn.tokens !== null;

  return (
    <div className="flex flex-col gap-2.5">
      {/* 用户消息：systemBlue 实底气泡、右对齐（iMessage 的语义：这是"我说的话"）。
          附件以 chip 呈现在气泡上方，正文本身不下发到界面。 */}
      <div className="flex flex-col items-end gap-1">
        {turn.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {turn.attachments.map((item, index) => (
              <span
                key={item.name + index}
                title={`${item.name}（${item.size.toLocaleString()} 字）`}
                className="inline-flex max-w-[200px] items-center gap-1 rounded-sm border-[0.5px] border-shell-border-l2 px-1.5 py-0.5 text-[11px] text-shell-label-tertiary"
              >
                <FileText className="h-3 w-3 flex-none" />
                <span className="truncate">{item.name}</span>
              </span>
            ))}
          </div>
        )}
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-primary px-3.5 py-2 text-[14px] leading-[1.45] text-primary-foreground">
          {renderMentions(turn.userContent, onOpenDocument, true)}
        </div>
      </div>

      {/* AI 回合内容：严格按事件顺序；助手回答不加气泡，按正文排版 */}
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
                  onConfirmDraft={onConfirmDraft}
                  onDiscardDraft={onDiscardDraft}
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

        {/* 还没吐出任何文本时的思考指示 —— 并给出**显式**的停止入口：
            此前只有输入框右侧一个无文字的方块图标，用户找不到"终止对话" */}
        {running && !trailingText && (
          <div className="flex flex-wrap items-center gap-2">
            <RunningClock startedAt={turn.createdAt} />
            <StopActions onStop={onStop} onStopAndNewSession={onStopAndNewSession} />
          </div>
        )}

        {/* 已经在吐字了也能停：贴在最后一轮内容下方 */}
        {running && trailingText && <StopActions onStop={onStop} onStopAndNewSession={onStopAndNewSession} />}

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
                className="inline-flex max-w-[240px] cursor-pointer items-center gap-1.5 rounded-sm bg-[color-mix(in_srgb,var(--shell-accent)_12%,transparent)] px-2 py-0.5 text-[12px] font-medium text-shell-accent transition-colors hover:bg-[color-mix(in_srgb,var(--shell-accent)_20%,transparent)]"
              >
                <span className="shrink-0" aria-hidden="true">📄</span>
                <span className="truncate">{ref.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* 回合 footer：ⓘ 披露运行详情（耗时 / tokens）+ 回合级操作。
            失败回合由上方错误卡承载，这里不重复。 */}
        {turn.status === "done" && (
          <div className="flex flex-col gap-1 pt-0.5">
            {metaOpen && hasMeta && (
              <p className="px-1.5 text-[11px] leading-4 text-shell-label-caption tabular-nums">
                {turn.durationMs !== null && <>耗时 {formatDuration(turn.durationMs)}</>}
                {turn.durationMs !== null && turn.tokens !== null && <span className="mx-1.5">·</span>}
                {turn.tokens !== null && (
                  <>
                    {turn.tokens.input.toLocaleString()} in / {turn.tokens.output.toLocaleString()} out tokens
                  </>
                )}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
              {hasMeta && (
                <button
                  type="button"
                  onClick={() => setMetaOpen((v) => !v)}
                  aria-expanded={metaOpen}
                  aria-label={metaOpen ? "收起本次运行详情" : "查看本次运行详情（耗时与 token 用量）"}
                  title={metaOpen ? "收起运行详情" : "运行详情（耗时 / tokens）"}
                  className={cn(
                    "flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-sm text-shell-label-caption transition-colors hover:bg-shell-row-hover hover:text-shell-label-secondary",
                    metaOpen && "bg-shell-row-hover text-shell-label-secondary",
                  )}
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              )}
              <TurnActions
                turn={turn}
                canInsertToDocument={canInsertToDocument}
                onRetry={onRetry}
                onUndo={onUndo}
                onPreviewChanges={onPreviewChanges}
                onEditUser={onEditUser}
                onInsertToDocument={onInsertToDocument}
                onSaveAsNote={onSaveAsNote}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** memo：流式期间每帧只应重渲"正在长的那一轮"，历史回合靠浅比较跳过 */
export const TurnView = memo(TurnViewInner);
