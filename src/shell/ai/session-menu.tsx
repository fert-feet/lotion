"use client";

// 历史会话面板（Popover dialog 的内容）：
// 搜索 / 相对时间 / 行内重命名 / 删除二次确认（用项目既有的 AlertDialog 原语）。
// 从 ai-panel.tsx 抽出来是为了让面板只管编排，不把列表交互细节堆在 700 行里。
import { useId, useState } from "react";
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
import { isImeConfirmingKey } from "@/lib/ime";
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
  const searchId = useId();
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
    <div className="flex min-h-0 max-h-[60vh] flex-col overflow-hidden">
      {/* 搜索：会话多了以后翻列表很痛苦 */}
      <search className="flex items-center gap-1.5 hairline-b border-shell-border px-2 py-1.5">
        <label htmlFor={searchId} className="sr-only">
          搜索历史会话
        </label>
        <Search className="h-3.5 w-3.5 flex-none text-shell-label-tertiary" aria-hidden="true" />
        <input
          id={searchId}
          type="search"
          name="session-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索会话"
          enterKeyHint="search"
          className="h-7 min-w-0 flex-1 bg-transparent text-body text-shell-label-primary outline-none placeholder:text-shell-label-placeholder"
        />
      </search>

      {canFilterByDocument && (
        <div
          role="group"
          aria-label="会话范围"
          className="flex items-center gap-1 hairline-b border-shell-border px-2 py-1"
        >
          {(["all", "document"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onScopeChange?.(value)}
              aria-pressed={scope === value}
              className={cn(
                "min-h-7 cursor-pointer rounded-control px-2 text-ui-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-shell-accent",
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
        <p className="px-3 py-4 text-ui-sm text-shell-label-tertiary">
          {sessions.length === 0 ? "暂无历史会话" : "没有匹配的会话"}
        </p>
      )}

      {visible.length > 0 && (
        <ul className="min-h-0 flex-1 overflow-y-auto p-1" aria-label="历史会话">
          {visible.map((session) => {
            const active = session.id === activeSessionId;
            if (renamingId === session.id) {
              return (
                <li key={session.id}>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      commitRename(session.id);
                    }}
                    className="flex items-center gap-1.5 px-1 py-0.5"
                  >
                    <label htmlFor={`rename-${session.id}`} className="sr-only">
                      会话标题
                    </label>
                    <input
                      id={`rename-${session.id}`}
                      autoFocus
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && isImeConfirmingKey(e.nativeEvent)) {
                          e.preventDefault();
                        }
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={(event) => {
                        const next = event.relatedTarget;
                        if (next instanceof Node && event.currentTarget.form?.contains(next)) return;
                        commitRename(session.id);
                      }}
                      className="h-8 min-w-0 flex-1 rounded-control hairline border-shell-border-l2 bg-card px-2 text-body text-shell-label-primary outline-none focus:border-shell-accent/50"
                    />
                    <button
                      type="submit"
                      aria-label="保存会话标题"
                      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-control text-shell-accent hover:bg-shell-row-hover"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </form>
                </li>
              );
            }
            return (
              <li
                key={session.id}
                className={cn(
                  "group/session flex items-center rounded-control",
                  active ? "bg-shell-row-active text-shell-label-primary" : "hover:bg-shell-row-hover",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  aria-current={active ? "true" : undefined}
                  className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control px-2 text-left text-ui focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-shell-accent"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-shell-label-tertiary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  {session.documentId && (
                    <FileText className="h-3 w-3 shrink-0 text-shell-label-caption" role="img" aria-label="已绑定文档" />
                  )}
                  <span className="shrink-0 text-caption tabular-nums text-shell-label-caption">
                    {formatRelativeTime(session.updatedAt)}
                  </span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-shell-accent" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  title="重命名会话"
                  aria-label={`重命名会话 ${session.title}`}
                  onClick={() => {
                    setDraftTitle(session.title);
                    setRenamingId(session.id);
                  }}
                  className="touch-target pointer-events-none size-7 shrink-0 cursor-pointer rounded-control text-shell-label-tertiary opacity-0 transition-[background-color,opacity] hover:bg-shell-row-hover hover:text-shell-label-primary focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/session:pointer-events-auto group-hover/session:opacity-100 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                >
                  <PenLine className="mx-auto h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="删除会话"
                  aria-label={`删除会话 ${session.title}`}
                  onClick={() => setPendingDelete(session)}
                  className="touch-target pointer-events-none mr-1 size-7 shrink-0 cursor-pointer rounded-control text-shell-label-tertiary opacity-0 transition-[background-color,opacity] hover:bg-destructive/10 hover:text-destructive focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/session:pointer-events-auto group-hover/session:opacity-100 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                >
                  <Trash2 className="mx-auto h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

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
