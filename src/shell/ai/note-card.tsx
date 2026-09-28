"use client";

// 文档副作用卡片（对齐 DSH command/notice 卡片家族）：
// created → "已创建草稿"卡片（可打开）；modified → chip（+ 撤销，见 undo 分支）；
// delete_confirm → danger 确认卡；move_confirm → 移动确认卡（对齐 SiYuan 写操作确认）。
// 确认类卡片在处理中禁用按钮（防双击重复请求），处理完以"已删除/已移动"收尾行保留痕迹。
import { useState } from "react";
import { AlertTriangle, ArrowRight, Ban, Check, FileText, Loader2, PenLine } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { NoteEvent } from "./types";

type ConfirmResult = void | Promise<unknown>;

interface NoteCardProps {
  note: NoteEvent;
  onOpen: (noteId: string) => void;
  onConfirmDelete: (noteId: string, title: string) => ConfirmResult;
  onCancelDelete: (noteId: string) => void;
  onConfirmMove: (noteId: string, title: string, parentDocument: string | null) => ConfirmResult;
  onCancelMove: (noteId: string) => void;
  /** AI 草稿确认：保存（isDraft=false）/ 丢弃（删除）——就在对话栏里完成 */
  onConfirmDraft: (noteId: string, title: string) => ConfirmResult;
  onDiscardDraft: (noteId: string, title: string) => ConfirmResult;
}

/** 已处理完的确认卡：保留一行痕迹，不再隐藏（用户能回看这轮到底删/移了什么） */
function ResolvedRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-0.5">
      <Check className="h-3.5 w-3.5 flex-none text-shell-label-tertiary" />
      <span className="min-w-0 truncate text-xs leading-5 text-shell-label-tertiary">{text}</span>
    </div>
  );
}

export function NoteCard({
  note,
  onOpen,
  onConfirmDelete,
  onCancelDelete,
  onConfirmMove,
  onCancelMove,
  onConfirmDraft,
  onDiscardDraft,
}: NoteCardProps) {
  const [busy, setBusy] = useState(false);

  // created：AI 草稿的确认就放在对话栏里（不再要求用户打开文档、在文档里的横幅上点确认）
  if (note.kind === "created") {
    const title = note.title || "无标题";
    if (note.resolved === "saved") {
      return <ResolvedRow text={`已保存「${title}」`} />;
    }
    if (note.resolved === "discarded") {
      return <ResolvedRow text={`已丢弃草稿「${title}」`} />;
    }
    const location = note.parentTitle ? `「${note.parentTitle}」下` : "根目录";
    return (
      <div className="rounded-xl border border-shell-border-l2 bg-shell-row-hover/70 px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-ai text-ai-foreground">
            <PenLine className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-5 text-shell-label-primary">
              已创建草稿「{title}」
            </p>
            <p className="mt-0.5 text-xs leading-4 text-shell-label-tertiary">
              位置：{location} · 确认后才会正式保存进笔记列表
            </p>
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpen(note.noteId)}
            className="inline-flex h-7 cursor-pointer items-center rounded-lg px-2.5 text-xs font-medium text-shell-label-secondary transition-colors hover:bg-shell-row-hover"
          >
            打开看看
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onDiscardDraft(note.noteId, title)).finally(() => setBusy(false));
            }}
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-shell-label-secondary transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-default disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
            丢弃
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onConfirmDraft(note.noteId, title)).finally(() => setBusy(false));
            }}
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            确认保存
          </button>
        </div>
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

  // move_confirm：移动确认卡（对齐 SiYuan 写操作确认：结构性操作需二次确认）
  if (note.kind === "move_confirm") {
    if (note.resolved) return <ResolvedRow text={`已移动「${note.title}」`} />;
    const target = note.toRoot ? "根目录" : note.targetTitle ? `「${note.targetTitle}」` : "新位置";
    return (
      <div className="rounded-xl border border-shell-border-l2 bg-shell-row-hover/50 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-shell-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-shell-label-primary">
              确认将「{note.title}」移动到{target}？
            </p>
            <p className="mt-0.5 text-xs text-shell-label-tertiary">移动会改变笔记的嵌套位置</p>
          </div>
        </div>
        <div className="mt-2.5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onCancelMove(note.noteId)}
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-shell-label-secondary transition-colors hover:bg-shell-row-hover disabled:cursor-default disabled:opacity-50"
          >
            <Ban className="h-3.5 w-3.5" />
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onConfirmMove(note.noteId, note.title, note.toRoot ? null : note.targetTitle)).finally(() => setBusy(false));
            }}
            className={cn(
              "inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg bg-shell-accent px-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
            )}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            确认移动
          </button>
        </div>
      </div>
    );
  }

  // delete_confirm
  if (note.resolved) return <ResolvedRow text={`已删除「${note.title}」`} />;
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
          disabled={busy}
          onClick={() => onCancelDelete(note.noteId)}
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-shell-label-secondary transition-colors hover:bg-shell-row-hover disabled:cursor-default disabled:opacity-50"
        >
          <Ban className="h-3.5 w-3.5" />
          取消
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void Promise.resolve(onConfirmDelete(note.noteId, note.title)).finally(() => setBusy(false));
          }}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg bg-destructive px-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
          )}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          确认删除
        </button>
      </div>
    </div>
  );
}
