"use client";

// 文档副作用卡片（对齐 DSH command/notice 卡片家族）：
// created → "已创建草稿"卡片（可打开）；modified → 轻量 chip；delete_confirm → danger 确认卡。
import { AlertTriangle, Ban, Check, FileText, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NoteEvent } from "./types";

interface NoteCardProps {
  note: NoteEvent;
  onOpen: (noteId: string) => void;
  onConfirmDelete: (noteId: string, title: string) => void;
  onCancelDelete: (noteId: string) => void;
}

export function NoteCard({ note, onOpen, onConfirmDelete, onCancelDelete }: NoteCardProps) {
  if (note.kind === "created") {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-shell-border-l2 bg-shell-row-hover/70 px-3 py-2.5">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-ai text-ai-foreground">
          <PenLine className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-shell-label-primary">
          已创建草稿「{note.title || "无标题"}」
        </span>
        <button
          type="button"
          onClick={() => onOpen(note.noteId)}
          className="flex-none cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-shell-accent transition-colors hover:bg-shell-row-active"
        >
          打开
        </button>
      </div>
    );
  }

  if (note.kind === "modified") {
    return (
      <div className="flex items-center gap-2 rounded-lg px-1 py-0.5">
        <FileText className="h-3.5 w-3.5 flex-none text-shell-label-tertiary" />
        <span className="min-w-0 truncate text-xs leading-5 text-shell-label-tertiary">
          已更新「{note.title || "笔记"}」
        </span>
        <button
          type="button"
          onClick={() => onOpen(note.noteId)}
          className="flex-none cursor-pointer text-xs text-shell-accent hover:underline"
        >
          查看
        </button>
      </div>
    );
  }

  // delete_confirm
  return (
    <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">确认永久删除「{note.title}」？</p>
          <p className="mt-0.5 text-xs text-destructive/80">此操作不可撤销</p>
        </div>
      </div>
      <div className="mt-2.5 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onCancelDelete(note.noteId)}
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-shell-label-secondary transition-colors hover:bg-shell-row-hover"
        >
          <Ban className="h-3.5 w-3.5" />
          取消
        </button>
        <button
          type="button"
          onClick={() => onConfirmDelete(note.noteId, note.title)}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg bg-destructive px-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          )}
        >
          <Check className="h-3.5 w-3.5" />
          确认删除
        </button>
      </div>
    </div>
  );
}