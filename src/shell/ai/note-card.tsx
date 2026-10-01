"use client";

// 文档副作用卡片（created / modified / delete_confirm / move_confirm）。
//
// 重构要点：
//   * 按钮改回设计系统原语 <Button>（此前是手搓的 div 式按钮，丢掉了 Apple 的
//     按压缩放与 3px 聚焦环）；破坏性动作走 ghost + destructive hover，
//     而不是实心红块 —— 确认卡里最重的动作应当由用户自己走过去。
//   * 卡片本身用 .surface-card / .surface-card-danger（设计系统里的卡片语义类），
//     不再在组件里拼 border + bg + shadow。
//   * 草稿图标改用 AiOrb（Apple Intelligence 渐变），与面板头部同一个身份标识。
//   * 文案一字未改：'已创建草稿「X」' / '确认保存' / '丢弃' / '已丢弃草稿「X」' 等
//     都被单测直接断言，改动会破坏"确认动作必须在对话栏完成"的回归保护。
import { useState } from "react";
import { AlertTriangle, ArrowRight, Ban, Check, FileText, Loader2, PenLine } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AiOrb } from "./ai-mark";
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
    <div className="flex items-center gap-2 px-0.5 py-0.5">
      <Check className="h-3.5 w-3.5 flex-none text-shell-label-tertiary" />
      <span className="min-w-0 truncate text-[12px] leading-5 text-shell-label-tertiary">{text}</span>
    </div>
  );
}

/** 确认卡的按钮行：右对齐，取消在左、确认在右（Apple 的对话框次序） */
function CardActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex items-center justify-end gap-1.5">{children}</div>;
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
      <div className="surface-card px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <AiOrb size={22} icon={<PenLine className="h-3 w-3" />} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-5 text-shell-label-primary">
              已创建草稿「{title}」
            </p>
            <p className="mt-0.5 text-[12px] leading-4 text-shell-label-tertiary">
              位置：{location} · 确认后才会正式保存进笔记列表
            </p>
          </div>
        </div>
        <CardActions>
          <Button variant="ghost" size="sm" onClick={() => onOpen(note.noteId)}>
            打开看看
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            className="text-shell-label-secondary hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onDiscardDraft(note.noteId, title)).finally(() => setBusy(false));
            }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
            丢弃
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onConfirmDraft(note.noteId, title)).finally(() => setBusy(false));
            }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            确认保存
          </Button>
        </CardActions>
      </div>
    );
  }

  if (note.kind === "modified") {
    return (
      <div className="flex items-center gap-2 px-0.5 py-0.5">
        <FileText className="h-3.5 w-3.5 flex-none text-shell-label-tertiary" />
        <span className="min-w-0 truncate text-[12px] leading-5 text-shell-label-tertiary">
          已更新「{note.title || "笔记"}」
        </span>
        <button
          type="button"
          onClick={() => onOpen(note.noteId)}
          className="flex-none cursor-pointer text-[12px] text-shell-accent hover:underline"
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
      <div className="surface-card px-3.5 py-3">
        <div className="flex items-start gap-2.5">
          <ArrowRight className="mt-0.5 h-4 w-4 flex-none text-shell-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium leading-5 text-shell-label-primary">
              确认将「{note.title}」移动到{target}？
            </p>
            <p className="mt-0.5 text-[12px] leading-4 text-shell-label-tertiary">移动会改变笔记的嵌套位置</p>
          </div>
        </div>
        <CardActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onCancelMove(note.noteId)}>
            <Ban className="h-3.5 w-3.5" />
            取消
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onConfirmMove(note.noteId, note.title, note.toRoot ? null : note.targetTitle)).finally(() => setBusy(false));
            }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            确认移动
          </Button>
        </CardActions>
      </div>
    );
  }

  // delete_confirm
  if (note.resolved) return <ResolvedRow text={`已删除「${note.title}」`} />;
  return (
    <div className="surface-card-danger px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5 text-destructive">确认永久删除「{note.title}」？</p>
          <p className="mt-0.5 text-[12px] leading-4 text-destructive/80">此操作不可撤销</p>
        </div>
      </div>
      <CardActions>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onCancelDelete(note.noteId)}>
          <Ban className="h-3.5 w-3.5" />
          取消
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          className={cn(busy && "opacity-60")}
          onClick={() => {
            setBusy(true);
            void Promise.resolve(onConfirmDelete(note.noteId, note.title)).finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          确认删除
        </Button>
      </CardActions>
    </div>
  );
}
