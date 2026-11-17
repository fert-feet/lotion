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
//   * 连续工具调用合并为一条默认收起的过程日志；已完成任务、多篇引用也按需展开；
//   * 复制 / 撤销 / 重试 / 插入 / 运行详情等次级操作统一收进回合末尾的一个菜单。
//
// ⚠️ 文案是契约：'正在思考' / '已创建草稿「X」' / '确认保存' / '丢弃' 等被
// test/components/ai/panel-streaming.test.tsx 直接断言，改字会破坏回归保护。
import { memo, useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Info,
  Loader2,
  MoreHorizontal,
  PenLine,
  Plus,
  RefreshCw,
  Undo,
} from "@/components/icons";
import { MarkdownText } from "@/components/markdown/MarkdownText";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { truncateMentionTitle } from "@/lib/mention";
import { cn } from "@/lib/utils";
import type { AiChangePreview } from "@/lib/seams/doc-store";
import type { Question, TodoItem, ToolCardState, Turn } from "./types";
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
    <div className="flex items-center gap-2 text-ui-sm leading-[18px] text-shell-label-tertiary">
      <AiDot size={7} running />
      <span>正在思考</span>
      {elapsed >= 15000 && <span className="tabular-nums">· {formatDuration(elapsed)}</span>}
    </div>
  );
}

/** 连续工具调用合并成一条过程日志；完成态默认收起，运行态自动展开。 */
function ToolActivityGroup({ cards }: { cards: ToolCardState[] }) {
  const running = cards.some((card) => card.state === "running");
  const failed = cards.some((card) => card.state === "error");
  const [open, setOpen] = useState(running);

  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);

  return (
    <details
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next !== open) setOpen(next);
      }}
      className="group/activity"
    >
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-control px-1 text-ui-sm text-shell-label-tertiary transition-colors hover:bg-shell-row-hover hover:text-shell-label-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-shell-accent [&::-webkit-details-marker]:hidden">
        {running ? (
          <AiDot size={7} running />
        ) : failed ? (
          <AlertTriangle className="h-3.5 w-3.5 flex-none text-destructive" />
        ) : (
          <Check className="h-3.5 w-3.5 flex-none" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {running ? `正在执行 ${cards.length} 项操作` : `${cards.length} 项工具操作`}
        </span>
        <ChevronDown className="h-3 w-3 flex-none transition-transform group-open/activity:rotate-180" />
      </summary>
      <div className="ml-2 mt-0.5 flex flex-col gap-0.5 border-l border-shell-border pl-2">
        {cards.map((card) => <ToolCard key={card.seq} card={card} />)}
      </div>
    </details>
  );
}

/** 任务清单卡片（对齐 SiYuan todo_write：多步任务进度跟踪） */
function TodoCard({ items, running }: { items: TodoItem[]; running: boolean }) {
  const statusLabel: Record<TodoItem["status"], string> = {
    pending: "待办",
    in_progress: "进行中",
    completed: "已完成",
    cancelled: "已取消",
  };
  const list = (
    <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 text-ui leading-5">
            {/* 勾/叉是图标字形而非可读正文：16px 圆圈里 10px 才是正确视觉重量
                （"最小 11px"针对正文，不针对符号） */}
            <span
              className={cn(
                "flex h-4 w-4 flex-none items-center justify-center rounded-full hairline text-caption font-semibold",
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
                "flex-none text-caption leading-4",
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
  );
  if (running) {
    return (
      <div className="surface-card px-3 py-2.5">
        <p className="mb-2 text-ui-sm font-medium text-shell-label-secondary">任务清单</p>
        {list}
      </div>
    );
  }
  const completed = items.filter((item) => item.status === "completed").length;
  return (
    <details className="group/todo">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-control px-1 text-ui-sm text-shell-label-tertiary transition-colors hover:bg-shell-row-hover hover:text-shell-label-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-shell-accent [&::-webkit-details-marker]:hidden">
        <Check className="h-3.5 w-3.5 flex-none" />
        <span className="min-w-0 flex-1">任务清单 · {completed}/{items.length} 已完成</span>
        <ChevronDown className="h-3 w-3 flex-none transition-transform group-open/todo:rotate-180" />
      </summary>
      <div className="mt-1 rounded-card bg-shell-row-hover/60 px-3 py-2">{list}</div>
    </details>
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
  const customId = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (question.answered) {
    return (
      <div className="flex items-start gap-2 px-1 py-0.5">
        <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-success" />
        <div className="min-w-0">
          <p className="text-ui-sm leading-5 text-shell-label-tertiary">{question.question}</p>
          <p className="text-ui leading-5 text-shell-label-primary">{question.answered}</p>
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
    if (selected.length === 0 && !(question.custom !== false && custom.trim())) return;
    setSubmitting(true);
    onAnswer(selected, question.custom === false ? undefined : custom);
  };
  const canSubmit = selected.length > 0 || (question.custom !== false && custom.trim().length > 0);

  return (
    <form
      aria-label="回答文档助手的问题"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="surface-card px-3.5 py-3"
    >
      <p id={`${customId}-question`} className="text-lead font-medium leading-6 text-shell-label-primary">
        {question.question}
      </p>
      {question.header && <p className="mb-2.5 mt-0.5 text-ui-sm leading-4 text-shell-label-tertiary">{question.header}</p>}
      <div
        role={question.multiple ? "group" : "radiogroup"}
        aria-labelledby={`${customId}-question`}
        className={cn("flex flex-col gap-1.5", !question.header && "mt-2.5")}
      >
        {question.options.map((opt) => {
          const active = selected.includes(opt.label);
          return (
            <label
              key={opt.label}
              className={cn(
                "relative min-h-10 cursor-pointer rounded-card hairline px-2.5 py-2 text-left transition-colors duration-150 ease-[var(--ds-ease-out)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-shell-accent",
                active
                  ? "border-shell-accent/50 bg-shell-accent/10"
                  : "border-shell-border-l2 hover:bg-shell-row-hover",
                submitting && "cursor-default opacity-50",
              )}
            >
              <input
                type={question.multiple ? "checkbox" : "radio"}
                name={`question-${customId}`}
                value={opt.label}
                checked={active}
                disabled={submitting}
                onChange={() => toggle(opt.label)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-ui font-medium leading-5 text-shell-label-primary">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-3.5 flex-none items-center justify-center rounded-full hairline border-shell-border-l2",
                    active && "border-shell-accent",
                  )}
                >
                  {active && <span className="size-1.5 rounded-full bg-shell-accent" />}
                </span>
                {opt.label}
              </span>
              {opt.description && (
                <span className="mt-0.5 block pl-5.5 text-ui-sm leading-4 text-shell-label-tertiary">{opt.description}</span>
              )}
            </label>
          );
        })}
        {question.custom !== false && (
          <>
            <label htmlFor={customId} className="sr-only">
              自定义回答
            </label>
            <input
              id={customId}
              name="custom-answer"
              value={custom}
              disabled={submitting}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="自定义回答（可选）"
              enterKeyHint="done"
              className="h-9 rounded-card hairline border-shell-border-l2 bg-transparent px-2.5 text-body text-shell-label-primary outline-none transition-colors placeholder:text-shell-label-placeholder focus:border-shell-accent/50"
            />
          </>
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          onClick={() => {
            setSubmitting(true);
            onAnswer([]);
          }}
        >
          跳过
        </Button>
        <Button type="submit" size="sm" disabled={submitting || !canSubmit}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          提交回答
        </Button>
      </div>
    </form>
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
        <p className={cn("min-w-0 flex-1 text-ui leading-5", danger ? "text-destructive" : "text-shell-label-primary")}>
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

/** 引用默认只占一条低调线索；多篇时用原生 details 按需展开。 */
function ReferenceTrail({
  references,
  onOpenDocument,
}: {
  references: Turn["references"];
  onOpenDocument: (id: string) => void;
}) {
  const chips = (items: Turn["references"]) => (
    <div className="flex flex-wrap gap-1.5">
      {items.map((ref) => (
        <button
          key={ref.noteId}
          type="button"
          onClick={() => onOpenDocument(ref.noteId)}
          className="inline-flex min-h-7 max-w-[240px] cursor-pointer items-center gap-1.5 rounded-control bg-shell-row-hover px-2 text-ui-sm text-shell-label-secondary transition-colors hover:bg-shell-row-active hover:text-shell-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-shell-accent"
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{ref.title}</span>
        </button>
      ))}
    </div>
  );

  if (references.length === 1) return chips(references);
  return (
    <details className="group/references">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-control px-1 text-ui-sm text-shell-label-tertiary transition-colors hover:bg-shell-row-hover hover:text-shell-label-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-shell-accent [&::-webkit-details-marker]:hidden">
        <FileText className="h-3.5 w-3.5 flex-none" />
        <span className="min-w-0 flex-1">参考了 {references.length} 篇笔记</span>
        <ChevronDown className="h-3 w-3 flex-none transition-transform group-open/references:rotate-180" />
      </summary>
      <div className="mt-1 px-1">{chips(references)}</div>
    </details>
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
  hasMeta,
  metaOpen,
  onToggleMeta,
}: {
  turn: Turn;
  canInsertToDocument: boolean;
  onRetry: (turn: Turn) => void;
  onUndo: (turn: Turn) => void;
  onPreviewChanges: (turn: Turn) => Promise<AiChangePreview[]>;
  onEditUser: (turn: Turn) => void;
  onInsertToDocument: (turn: Turn) => void;
  onSaveAsNote: (turn: Turn) => void;
  hasMeta: boolean;
  metaOpen: boolean;
  onToggleMeta: () => void;
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
    "flex size-7 cursor-pointer items-center justify-center rounded-control text-shell-label-tertiary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-shell-accent";

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
      <span className="flex justify-end" data-turn-actions>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={actionClass}
              aria-label="回答操作"
              title="回答操作"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4} className="w-48">
            {hasText && (
              <DropdownMenuItem onClick={() => void copy()}>
                <Copy />
                复制回答
              </DropdownMenuItem>
            )}
            {turn.changedDocuments.length > 0 && turn.requestId && !turn.undone && (
              <DropdownMenuItem onClick={() => onUndo(turn)}>
                <Undo />
                撤销本次改动
              </DropdownMenuItem>
            )}
            {turn.undone && turn.changedDocuments.length > 0 && (
              <DropdownMenuItem disabled>
                <Undo />
                已撤销本次改动
              </DropdownMenuItem>
            )}
            {turn.changedDocuments.length > 0 && !turn.undone && (
              <DropdownMenuItem onClick={() => void togglePreview()}>
                {previewLoading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ChevronDown className={cn("transition-transform", preview && "rotate-180")} />
                )}
                {preview ? "收起改动对照" : "查看改动对照"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onRetry(turn)}>
              <RefreshCw />
              重新生成
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEditUser(turn)}>
              <PenLine />
              编辑重发
            </DropdownMenuItem>
            {hasText && canInsertToDocument && (
              <DropdownMenuItem onClick={() => onInsertToDocument(turn)}>
                <FileText />
                插入本文档
              </DropdownMenuItem>
            )}
            {hasText && (
              <DropdownMenuItem onClick={() => onSaveAsNote(turn)}>
                <Plus />
                另存为笔记
              </DropdownMenuItem>
            )}
            {hasMeta && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onToggleMeta}>
                  <Info />
                  {metaOpen ? "收起运行详情" : "运行详情"}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      {preview && preview.length > 0 && (
        <div className="mt-1.5 w-full space-y-2 rounded-card hairline border-shell-border bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] p-2.5">
          {preview.map((change) => (
            <div key={change.documentId} className="space-y-1">
              <p className="text-caption font-medium text-shell-label-secondary">
                {change.beforeTitle === change.title
                  ? change.title
                  : `${change.beforeTitle} → ${change.title}`}
              </p>
              <div className="grid grid-cols-2 gap-2 text-caption leading-4">
                <div className="rounded-card bg-destructive/5 p-2">
                  <p className="mb-1 text-caption font-medium text-destructive">改动前</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-shell-label-secondary">
                    {change.before.trim() || "（空）"}
                  </pre>
                </div>
                <div className="rounded-card bg-shell-accent/5 p-2">
                  <p className="mb-1 text-caption font-medium text-shell-accent">改动后</p>
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

function TurnViewInner({ turn, onOpenDocument, onConfirmDelete, onCancelDelete, onConfirmMove, onCancelMove, onConfirmDraft, onDiscardDraft, onAnswerQuestion, onRetry, onUndo, onPreviewChanges, onEditUser, onInsertToDocument, onSaveAsNote, canInsertToDocument }: TurnProps) {
  const running = turn.status === "running";
  const lastPartIndex = turn.parts.length - 1;
  const trailingText = turn.parts[lastPartIndex]?.kind === "text";
  // 运行详情（耗时 / tokens）默认收起：这是开发者元信息，不该常驻抢注意力
  const [metaOpen, setMetaOpen] = useState(false);
  const hasMeta = turn.durationMs !== null || turn.tokens !== null;

  return (
    <article className="flex flex-col gap-2.5">
      {/* 用户消息：systemBlue 实底气泡、右对齐（iMessage 的语义：这是"我说的话"）。
          附件以 chip 呈现在气泡上方，正文本身不下发到界面。 */}
      <div className="flex flex-col items-end gap-1">
        {turn.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {turn.attachments.map((item, index) => (
              <span
                key={item.name + index}
                title={`${item.name}（${item.size.toLocaleString()} 字）`}
                className="inline-flex max-w-[200px] items-center gap-1 rounded-control hairline border-shell-border-l2 px-1.5 py-0.5 text-caption text-shell-label-tertiary"
              >
                <FileText className="h-3 w-3 flex-none" />
                <span className="truncate">{item.name}</span>
              </span>
            ))}
          </div>
        )}
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-sheet bg-primary px-3.5 py-2 text-lead leading-[1.45] text-primary-foreground">
          <span className="sr-only">你说：</span>
          {renderMentions(turn.userContent, onOpenDocument, true)}
        </div>
      </div>

      {/* AI 回合内容：严格按事件顺序；助手回答不加气泡，按正文排版 */}
      <div role="group" aria-label="文档助手回答" className="flex flex-col gap-2">
        {(() => {
          const nodes: React.ReactNode[] = [];
          for (let i = 0; i < turn.parts.length;) {
            const part = turn.parts[i];
            if (part.kind === "tool") {
              const cards: ToolCardState[] = [];
              const start = i;
              while (i < turn.parts.length && turn.parts[i]?.kind === "tool") {
                const current = turn.parts[i];
                const card = current?.kind === "tool"
                  ? turn.tools.find((item) => item.seq === current.seq)
                  : undefined;
                if (card) cards.push(card);
                i += 1;
              }
              if (cards.length === 1) {
                nodes.push(<ToolCard key={`tool-${start}`} card={cards[0]} />);
              } else if (cards.length > 1) {
                nodes.push(<ToolActivityGroup key={`tool-group-${start}`} cards={cards} />);
              }
              continue;
            }
            switch (part.kind) {
              case "text":
                nodes.push(
                  // 正文的字号/行高/颜色由 .md-content 一处决定（components/markdown/markdown.css），
                  // 这里再挂 text-lead / leading 会形成两套真相源
                  <div key={`text-${i}`}>
                    <MarkdownText
                      text={part.text}
                      streaming={running && i === lastPartIndex}
                      onOpenDocument={onOpenDocument}
                    />
                  </div>,
                );
                break;
              case "note": {
                const note = turn.notes[part.index];
                if (note) {
                  nodes.push(
                    <NoteCard
                      key={`note-${i}`}
                      note={note}
                      onOpen={onOpenDocument}
                      onConfirmDelete={onConfirmDelete}
                      onCancelDelete={onCancelDelete}
                      onConfirmMove={onConfirmMove}
                      onCancelMove={onCancelMove}
                      onConfirmDraft={onConfirmDraft}
                      onDiscardDraft={onDiscardDraft}
                    />,
                  );
                }
                break;
              }
              case "todo":
                if (turn.todos.length > 0) {
                  nodes.push(<TodoCard key={`todo-${i}`} items={turn.todos} running={running} />);
                }
                break;
              case "question": {
                const question = turn.questions[part.index];
                if (question) {
                  nodes.push(
                    <QuestionCard
                      key={`question-${i}`}
                      question={question}
                      onAnswer={(answers, customText) =>
                        onAnswerQuestion(turn.id, part.index, question, answers, customText)}
                    />,
                  );
                }
                break;
              }
              case "warning": {
                const message = turn.warnings[part.index];
                if (message) {
                  nodes.push(<NoticeCard key={`warning-${i}`} level="warning" message={message} />);
                }
                break;
              }
            }
            i += 1;
          }
          return nodes;
        })()}

        {/* 停止入口固定在输入区；这里只保留安静的运行状态，避免同一回合出现两套按钮。 */}
        {running && !trailingText && (
          <RunningClock startedAt={turn.createdAt} />
        )}

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
          <ReferenceTrail references={turn.references} onOpenDocument={onOpenDocument} />
        )}

        {/* 回合 footer：所有次级操作统一收进一个菜单，正文后只留一个操作入口。 */}
        {turn.status === "done" && (
          <div className="flex flex-col gap-1 pt-0.5">
            {metaOpen && hasMeta && (
              <p className="px-1.5 text-caption leading-4 text-shell-label-caption tabular-nums">
                {turn.durationMs !== null && <>耗时 {formatDuration(turn.durationMs)}</>}
                {turn.durationMs !== null && turn.tokens !== null && <span className="mx-1.5">·</span>}
                {turn.tokens !== null && (
                  <>
                    {turn.tokens.input.toLocaleString()} in / {turn.tokens.output.toLocaleString()} out tokens
                  </>
                )}
              </p>
            )}
            <div>
              <TurnActions
                turn={turn}
                canInsertToDocument={canInsertToDocument}
                onRetry={onRetry}
                onUndo={onUndo}
                onPreviewChanges={onPreviewChanges}
                onEditUser={onEditUser}
                onInsertToDocument={onInsertToDocument}
                onSaveAsNote={onSaveAsNote}
                hasMeta={hasMeta}
                metaOpen={metaOpen}
                onToggleMeta={() => setMetaOpen((value) => !value)}
              />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

/** memo：流式期间每帧只应重渲"正在长的那一轮"，历史回合靠浅比较跳过 */
export const TurnView = memo(TurnViewInner);
