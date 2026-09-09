"use client";

// Dialog —— macOS 工作表（sheet）语言：
// 遮罩压暗 + 轻微模糊，卡片 16px 连续圆角、发丝描边、柔和多层阴影。
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { X } from "@/components/icons";
import { Slot } from "./_primitives";

interface DialogCtx { open: boolean; setOpen: (v: boolean) => void; }
const Ctx = createContext<DialogCtx>({ open: false, setOpen: () => {} });

function Dialog({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (v: boolean) => void; children: ReactNode }) {
  const [inner, setInner] = useState(false);
  const value = useMemo<DialogCtx>(() => ({
    open: open ?? inner,
    setOpen: (v) => { if (open === undefined) setInner(v); onOpenChange?.(v); },
  }), [open, inner, onOpenChange]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function DialogTrigger({ asChild = true, children, className, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { setOpen } = useContext(Ctx);
  const p = { type: "button" as const, className, onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpen(true); }, ...props };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

function DialogClose({ asChild = true, children, className, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { setOpen } = useContext(Ctx);
  const p = { type: "button" as const, className, onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpen(false); }, ...props };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

function DialogContent({ className, children, showCloseButton = true, ...props }: HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean; children: ReactNode }) {
  const { open, setOpen } = useContext(Ctx);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px] dark:bg-black/45" onClick={() => setOpen(false)} />
      <div
        className={cn(
          "material-popover relative z-10 w-full max-w-lg rounded-[16px] border-[0.5px] border-shell-border-l2 p-6 shadow-[var(--shadow-lg)]",
          className,
        )}
        {...props}
      >
        {showCloseButton && (
          <DialogClose className="absolute right-3.5 top-3.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-secondary text-shell-label-secondary transition-colors hover:bg-[color-mix(in_srgb,var(--secondary)_75%,var(--foreground))] hover:text-shell-label-primary">
            <X className="h-3.5 w-3.5" />
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
const DialogTitle = ({ className, children }: { className?: string; children: ReactNode }) => <h2 className={cn("text-[15px] font-semibold leading-6 tracking-[-0.01em] text-shell-label-primary", className)}>{children}</h2>;
const DialogDescription = ({ className, children }: { className?: string; children: ReactNode }) => <p className={cn("text-[13px] leading-5 text-shell-label-tertiary", className)}>{children}</p>;
const DialogOverlay = ({ className }: { className?: string }) => <div className={cn("fixed inset-0 z-[99999] bg-black/25 backdrop-blur-[2px] dark:bg-black/45", className)} />;
const DialogPortal = ({ children }: { children: ReactNode }) => <>{children}</>;

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogOverlay, DialogPortal };
