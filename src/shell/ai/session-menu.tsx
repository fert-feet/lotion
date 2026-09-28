"use client";

// 历史会话列表（DropdownMenuContent 的内容）：
// 搜索 / 相对时间 / 行内重命名 / 删除二次确认（用项目既有的 AlertDialog 原语）。
// 从 ai-panel.tsx 抽出来是为了让面板只管编排，不把列表交互细节堆在 700 行里。
import { useState } from "react";
import { Check, FileText, MessageSquare, PenLine, Search, Trash2 } from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/lib/seams/doc-store";
import { filterSessions, formatRelativeTime, sortSessionsByRecent } from "./session-utils";

interface SessionMenuProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  /** 作用域过滤（会话可绑定文档） */
  scope?: "all" | "document";
  canFilterByDocument?: boolean;
  onScopeChange?: (scope: "all" | "document") => void;
}

export function SessionMenu({
  sessions,
  activeSessionId,
  onSelect,
  onRename,
  onDelete,
  scope = "all",
  canFilterByDocument = false,
  onScopeChange,
}: SessionMenuProps) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);

  const visible = filterSessions(sortSessionsByRecent(sessions), query);

  const commitRename = (sessionId: string) => {
    const title = draftTitle.trim();
    setRenamingId(null);
    const current = sessions.find((s) => s.id === sessionId);
    if (title && title !== current?.title) onRename(sessionId, title);
  };

  return (
    <div className="flex flex-col">
      {/* 搜索：会话多了以后翻列表很痛苦 */}
      <div className="flex items-center gap-1.5 border-b-[0.5px] border-shell-border px-2 py-1.5">
        <Search className="h-3.5 w-3.5 flex-none text-shell-label-tertiary" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // 菜单内输入：阻止 Radix 把按键当菜单导航
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="搜索会话"
          aria-label="搜索历史会话"
          className="h-6 min-w-0 flex-1 bg-transparent text-xs text-shell-label-primary outline-none placeholder:text-shell-label-caption"
        />
      </div>

      {canFilterByDocument && (
        <div className="flex items-center gap-1 border-b-[0.5px] border-shell-border px-2 py-1">
          {(["all", "document"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onScopeChange?.(value)}
              className={cn(
                "cursor-pointer rounded-md px-2 py-0.5 text-[11px] transition-colors",
                scope === value
                  ? "bg-shell-row-active text-shell-label-primary"
                  : "text-shell-label-tertiary hover:bg-shell-row-hover",
              )}
            >
              {value === "all" ? "全部会话" : "只看本文档"}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 && (
        <div className="px-2 py-2 text-xs text-shell-label-tertiary">
          {sessions.length === 0 ? "暂无历史会话" : "没有匹配的会话"}
        </div>
      )}

      {visible.map((session) => {
        const active = session.id === activeSessionId;
        if (renamingId === session.id) {
          return (
            <div key={session.id} className="flex items-center gap-1.5 px-2 py-1">
              <input
                autoFocus
                aria-label="会话标题"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commitRename(session.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                onBlur={() => commitRename(session.id)}
                className="h-6 min-w-0 flex-1 rounded-[6px] border-[0.5px] border-shell-border-l2 bg-card px-2 text-xs text-shell-label-primary outline-none focus:border-shell-accent/50"
              />
            </div>
          );
        }
        return (
          <div
            key={session.id}
            className={cn(
              "group/session flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px]",
              active ? "bg-shell-row-active text-shell-label-primary" : "hover:bg-shell-row-hover",
            )}
            onClick={() => onSelect(session.id)}
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-shell-label-tertiary" />
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
            {session.documentId && (
              <FileText className="h-3 w-3 shrink-0 text-shell-label-caption" aria-label="已绑定文档" />
            )}
            <span className="shrink-0 text-[10px] tabular-nums text-shell-label-caption">
              {formatRelativeTime(session.updatedAt)}
            </span>
            {active && <Check className="h-3.5 w-3.5 shrink-0 text-shell-accent" />}
            <button
              type="button"
              title="重命名会话"
              aria-label="重命名会话"
              onClick={(e) => {
                e.stopPropagation();
                setDraftTitle(session.title);
                setRenamingId(session.id);
              }}
              className="shrink-0 cursor-pointer rounded p-0.5 text-shell-label-tertiary opacity-0 transition-opacity hover:bg-shell-row-hover hover:text-shell-label-primary group-hover/session:opacity-100"
            >
              <PenLine className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="删除会话"
              aria-label="删除会话"
              onClick={(e) => {
                e.stopPropagation();
                setPendingDelete(session);
              }}
              className="shrink-0 cursor-pointer rounded p-0.5 text-shell-label-tertiary opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/session:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      {/* 删除确认：真实对话框（原来要点两次同一个按钮，容易误删也容易错过） */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个会话？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.title ?? ""}」的全部对话记录会被永久删除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">取消</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer"
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target) onDelete(target.id);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
