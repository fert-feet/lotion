"use client";

import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import { useDocStore } from "@/src/kernel/react";
import { truncateMentionTitle } from "@/lib/mention";
import { FileText } from "@/components/icons";
import { parseMentionText, resolveMentionKey, serializeMentionEditor } from "./mention-input-logic";
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MentionInputHandle {
  /** 外部触发提交（发送按钮点击） */
  submit: () => void;
  /** 回填内容（编辑重发：把历史消息放回输入框，胶囊还原为胶囊） */
  setText: (text: string) => void;
}

interface MentionInputProps {
  /** 提交（Enter）时回调，参数为序列化后的文本（含 [@标题](id) 标记） */
  onSubmit: (text: string) => void;
  /** 内容是否为空（供外部禁用发送按钮） */
  onEmptyChange?: (empty: boolean) => void;
  /** Esc（@ 菜单未打开时）：用于"停止生成"这类面板级快捷键 */
  onEscape?: () => void;
  /** 空输入时按 ↑：召回上一条消息（由面板决定召回什么） */
  onRecall?: () => void;
  placeholder?: string;
  className?: string;
  ref?: React.Ref<MentionInputHandle>;
}

/** 光标前最后一个 @token（支持中文等任意字母/数字） */
const MENTION_TOKEN_RE = /@([\p{L}\p{N}_-]*)$/u;

/**
 * 支持 @提及文档的胶囊输入框：
 * - 输入 @ 弹出文档选择列表，可继续输入过滤，↑↓/Enter/Esc 键盘操作
 * - 选中后以胶囊（标题 + 截断 id）插入，前后可继续输入自然语言
 * - Enter 发送、Shift+Enter 换行（多行草稿）；Esc 关闭菜单或触发面板级回调
 * - 提交时序列化为 `[@标题](文档id)` 文本（<br>/<div> 换行还原为 \n）
 */
export default function MentionInput({
  onSubmit,
  onEmptyChange,
  onEscape,
  onRecall,
  placeholder,
  className,
  ref,
}: MentionInputProps) {
  const docStore = useDocStore();
  const { user } = useUser();
  const sidebarKey = useRefresh((s) => s.sidebarKey);
  const editorRef = useRef<HTMLDivElement>(null);
  const [docs, setDocs] = useState<SidebarDocument[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  // 输入框空状态（供 ↑ 召回判定，不走 state 以免每次击键重渲）
  const emptyRef = useRef(true);

  // 文档列表（@ 选择的数据源）：依赖 sidebarKey——新建/删除/归档/AI 创建文档等
  // 任何触发侧边栏刷新的操作都会递增它，保证 @ 列表及时拿到新文档
  useEffect(() => {
    if (user) {
      docStore.listSearch({ userId: user.id }).then(setDocs).catch(() => {});
    }
  }, [user, sidebarKey, docStore]);

  const closeMention = useCallback(() => setMentionOpen(false), []);

  const filtered = docs
    .filter((d) => d.title.toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 8);

  // @ 列表数据刷新（docs 异步更新）后 filtered 可能变短，highlightIndex 越界时 clamp，
  // 防止 Enter 时 filtered[highlightIndex] 为 undefined 崩溃
  useEffect(() => {
    if (mentionOpen && highlightIndex >= filtered.length) {
      setHighlightIndex(Math.max(0, filtered.length - 1));
    }
  }, [mentionOpen, filtered.length, highlightIndex]);

  // 输入时检测光标前是否在输入 @token；同时同步内容空状态
  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const empty = !el.textContent?.trim();
    emptyRef.current = empty;
    onEmptyChange?.(empty);

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return closeMention();
    const node = sel.anchorNode;
    const offset = sel.anchorOffset;
    if (node?.nodeType !== Node.TEXT_NODE || !el.contains(node)) return closeMention();
    const match = (node.textContent ?? "").slice(0, offset).match(MENTION_TOKEN_RE);
    if (match) {
      setMentionQuery(match[1]);
      setHighlightIndex(0);
      setMentionOpen(true);
    } else {
      closeMention();
    }
  }, [closeMention, onEmptyChange]);

  // 把光标前的 @token 替换为胶囊 span
  const insertMention = useCallback((doc: SidebarDocument) => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    const offset = sel?.anchorOffset ?? 0;
    if (!node || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return;

    const text = node.textContent ?? "";
    const before = text.slice(0, offset);
    const match = before.match(MENTION_TOKEN_RE);
    if (!match) return;

    const keep = before.slice(0, match.index);
    const rest = text.slice(offset);

    // 胶囊：标题 + 截断 id（完整 id 放 title 提示）
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.docId = doc.id;
    chip.dataset.docTitle = doc.title;
    chip.title = doc.id; // 完整 id 放悬停提示，视觉只显示 @标题
    chip.className = "mention-chip select-none";
    const chipText = document.createElement("span");
    chipText.textContent = "@" + truncateMentionTitle(doc.title);
    chip.appendChild(chipText);

    // 文本节点拆分为 keep + 胶囊 + rest
    node.textContent = keep;
    const restNode = document.createTextNode(rest);
    node.parentElement?.insertBefore(chip, node.nextSibling);
    node.parentElement?.insertBefore(restNode, chip.nextSibling);

    // 光标移到胶囊后
    const range = document.createRange();
    range.setStart(restNode, 0);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);

    setMentionOpen(false);
    emptyRef.current = false;
    onEmptyChange?.(false);
    el.focus();
  }, [onEmptyChange]);

  // 序列化：胶囊 → [@标题](id)，<br>/块级元素换行 → \n，其余为纯文本
  const serialize = useCallback((): string => serializeMentionEditor(editorRef.current), []);

  // 提交：序列化 → 回调 → 清空编辑器
  const submit = useCallback(() => {
    const text = serialize().trim();
    if (!text) return;
    onSubmit(text);
    if (editorRef.current) editorRef.current.innerHTML = "";
    setMentionOpen(false);
    emptyRef.current = true;
    onEmptyChange?.(true);
    editorRef.current?.focus();
  }, [onSubmit, onEmptyChange, serialize]);

  // 把 `[@标题](id)` 文本回填到 contentEditable（胶囊仍渲染为胶囊）
  const setText = useCallback(
    (text: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.innerHTML = "";
      for (const segment of parseMentionText(text)) {
        if (segment.kind === "text") {
          el.appendChild(document.createTextNode(segment.value));
          continue;
        }
        const chip = document.createElement("span");
        chip.contentEditable = "false";
        chip.dataset.docId = segment.id;
        chip.dataset.docTitle = segment.title;
        chip.title = segment.id;
        chip.className = "mention-chip select-none";
        const chipText = document.createElement("span");
        chipText.textContent = "@" + truncateMentionTitle(segment.title);
        chip.appendChild(chipText);
        el.appendChild(chip);
      }
      setMentionOpen(false);
      const empty = !el.textContent?.trim();
      emptyRef.current = empty;
      onEmptyChange?.(empty);
      el.focus();
    },
    [onEmptyChange],
  );

  // 暴露 submit / setText 给外部（发送按钮 / 编辑重发）
  useImperativeHandle(ref, () => ({ submit, setText }), [submit, setText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 键盘意图由纯函数判定（Enter 发送 / Shift+Enter 换行 / Esc 关菜单或交还面板）
      const action = resolveMentionKey({
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        mentionOpen,
        itemCount: filtered.length,
        empty: emptyRef.current,
      });

      switch (action.kind) {
        case "highlight":
          e.preventDefault();
          setHighlightIndex((i) =>
            action.delta === 1
              ? Math.min(i + 1, filtered.length - 1)
              : Math.max(i - 1, 0),
          );
          return;
        case "select": {
          e.preventDefault();
          // 防御：clamp 后仍可能处于竞态窗口，取不到目标时忽略
          const target = filtered[Math.min(highlightIndex, filtered.length - 1)];
          if (target) insertMention(target);
          return;
        }
        case "close":
          closeMention();
          return;
        case "escape":
          onEscape?.();
          return;
        case "recall":
          e.preventDefault();
          onRecall?.();
          return;
        case "submit":
          e.preventDefault();
          submit();
          return;
        case "ignore":
          return;
      }
    },
    [mentionOpen, filtered, highlightIndex, insertMention, closeMention, submit, onEscape, onRecall]
  );

  return (
    <div className={cn("relative", className)}>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder ?? "输入消息，可用 @ 提及文档"}
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        className="mention-editor max-h-32 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-3 pt-2 text-[14px] leading-[1.5] focus:outline-none"
      />
      {mentionOpen && (
        <div className="material-popover absolute bottom-full left-0 z-50 mb-1 max-h-56 w-72 overflow-y-auto rounded-[10px] border-[0.5px] border-shell-border-l2 p-1 shadow-[var(--shadow-md)]">
          {filtered.length === 0 && (
            <div className="px-2.5 py-2 text-xs text-muted-foreground">没有匹配的文档</div>
          )}
          {filtered.map((d, i) => (
            <button
              key={d.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertMention(d)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm transition-colors",
                i === highlightIndex ? "bg-shell-row-active text-shell-label-primary" : "hover:bg-shell-row-hover"
              )}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">{d.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}