"use client";

// Dialog —— macOS 工作表（sheet）语言：
// 遮罩压暗 + 轻微模糊，卡片 16px 连续圆角、发丝描边、柔和多层阴影。
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { X } from "@/components/icons";
import { Slot } from "./_primitives";
import { useDialogFocus } from "./_focus";

// titleId 由 Dialog 生成：DialogTitle 挂 id，DialogContent 用 aria-labelledby 指回来
// —— 否则读屏软件只会念「对话框」，不念它是什么对话框。
interface DialogCtx { open: boolean; setOpen: (v: boolean) => void; titleId: string; }
const Ctx = createContext<DialogCtx>({ open: false, setOpen: () => {}, titleId: "" });

function Dialog({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (v: boolean) => void; children: ReactNode }) {
  const [inner, setInner] = useState(false);
  const titleId = useId();
  const value = useMemo<DialogCtx>(() => ({
    open: open ?? inner,
    setOpen: (v) => { if (open === undefined) setInner(v); onOpenChange?.(v); },
    titleId,
  }), [open, inner, onOpenChange, titleId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function DialogTrigger({ asChild = true, children, className, onClick, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { setOpen } = useContext(Ctx);
  // onClick 必须组合：调用方传的 onClick 不能把「打开」顶掉
  const p = { type: "button" as const, className, ...props, onClick: (e: React.MouseEvent<HTMLButtonElement>) => { onClick?.(e); e.stopPropagation(); setOpen(true); } };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

function DialogClose({ asChild = true, children, className, onClick, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { setOpen } = useContext(Ctx);
  const p = { type: "button" as const, className, ...props, onClick: (e: React.MouseEvent<HTMLButtonElement>) => { onClick?.(e); e.stopPropagation(); setOpen(false); } };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

function DialogContent({ className, children, showCloseButton = true, ...props }: HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean; children: ReactNode }) {
  const { open, setOpen, titleId } = useContext(Ctx);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, panelRef);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px] dark:bg-black/45" onClick={() => setOpen(false)} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId || undefined}
        tabIndex={-1}
        className={cn(
          "material-popover relative z-10 w-full max-w-lg rounded-sheet hairline border-shell-border-l2 p-6 shadow-elevation-3 outline-none",
          className,
        )}
        {...props}
      >
        {showCloseButton && (
          // 关闭按钮必须是真的 <button>：之前用 asChild 把 onClick/type 合并进 <X/> 这个 <svg>，
          // 结果是「长得像按钮的图标」——不可聚焦、无 aria、还会因 className 被覆盖而贴到左上角。
          <DialogClose
            asChild={false}
            aria-label="关闭"
            className="absolute right-3.5 top-3.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-secondary text-shell-label-secondary transition-colors hover:bg-[color-mix(in_srgb,var(--secondary)_75%,var(--foreground))] hover:text-shell-label-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </DialogClose>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

const DialogHeader = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn("mb-4 flex flex-col gap-1 text-center", className)}>{children}</div>;
const DialogFooter = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn("mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}>{children}</div>;
function DialogTitle({ className, children }: { className?: string; children: ReactNode }) {
  const { titleId } = useContext(Ctx);
  return <h2 id={titleId} className={cn("text-lead font-semibold leading-6 tracking-[-0.01em] text-shell-label-primary", className)}>{children}</h2>;
}
const DialogDescription = ({ className, children }: { className?: string; children: ReactNode }) => <p className={cn("text-ui leading-5 text-shell-label-tertiary", className)}>{children}</p>;
const DialogOverlay = ({ className }: { className?: string }) => <div className={cn("fixed inset-0 z-modal bg-black/25 backdrop-blur-[2px] dark:bg-black/45", className)} />;
const DialogPortal = ({ children }: { children: ReactNode }) => <>{children}</>;

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogOverlay, DialogPortal };
