"use client";

import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import { getSearch, type SidebarDocument } from "@/lib/db";
import { truncateMentionTitle } from "@/lib/mention";
import { FileText } from "@/components/icons";
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MentionInputHandle {
  /** 外部触发提交（发送按钮点击） */
  submit: () => void;
}

interface MentionInputProps {
  /** 提交（Enter）时回调，参数为序列化后的文本（含 [@标题](id) 标记） */
  onSubmit: (text: string) => void;
  /** 内容是否为空（供外部禁用发送按钮） */
  onEmptyChange?: (empty: boolean) => void;
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
 * - 提交时序列化为 `[@标题](文档id)` 文本
 */
export default function MentionInput({
  onSubmit,
  onEmptyChange,
  placeholder,
  className,
  ref,
}: MentionInputProps) {
  const { user } = useUser();
  const sidebarKey = useRefresh((s) => s.sidebarKey);
  const editorRef = useRef<HTMLDivElement>(null);
  const [docs, setDocs] = useState<SidebarDocument[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);

  // 文档列表（@ 选择的数据源）：依赖 sidebarKey——新建/删除/归档/AI 创建文档等
  // 任何触发侧边栏刷新的操作都会递增它，保证 @ 列表及时拿到新文档
  useEffect(() => {
    if (user) {
      getSearch(user.id).then(setDocs).catch(() => {});
    }
  }, [user, sidebarKey]);

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
    onEmptyChange?.(!el.textContent?.trim());

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
    onEmptyChange?.(false);
    el.focus();
  }, [onEmptyChange]);

  // 序列化：胶囊 → [@标题](id)，其余为纯文本
  const serialize = useCallback((): string => {
    const el = editorRef.current;
    if (!el) return "";
    let out = "";
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent ?? "";
      } else if (node instanceof HTMLElement && node.dataset.docId) {
        out += `[@${node.dataset.docTitle}](${node.dataset.docId})`;
      } else {
        for (const child of Array.from(node.childNodes)) visit(child);
      }
    };
    for (const child of Array.from(el.childNodes)) visit(child);
    return out;
  }, []);

  // 提交：序列化 → 回调 → 清空编辑器
  const submit = useCallback(() => {
    const text = serialize().trim();
    if (!text) return;
    onSubmit(text);
    if (editorRef.current) editorRef.current.innerHTML = "";
    setMentionOpen(false);
    onEmptyChange?.(true);
    editorRef.current?.focus();
  }, [onSubmit, onEmptyChange, serialize]);

  // 暴露 submit 给外部（发送按钮）
  useImperativeHandle(ref, () => ({ submit }), [submit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return; // IME 组词中不拦截

      if (mentionOpen && filtered.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHighlightIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          // 防御：clamp 后仍可能处于竞态窗口，取不到目标时忽略
          const target = filtered[Math.min(highlightIndex, filtered.length - 1)];
          if (target) insertMention(target);
          return;
        }
      }
      if (e.key === "Escape") {
        closeMention();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    },
    [mentionOpen, filtered, highlightIndex, insertMention, closeMention, submit]
  );

  return (
    <div className={cn("relative", className)}>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
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