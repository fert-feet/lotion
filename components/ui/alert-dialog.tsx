"use client";

// AlertDialog —— 与 Dialog 同一套 macOS sheet 语言（危险操作确认）
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Slot } from "./_primitives";
import { useDialogFocus } from "./_focus";

// titleId：AlertDialogTitle 挂 id，Content 用 aria-labelledby 指回来（读屏要念出「删除什么」）
interface Ctx { open: boolean; setOpen: (v: boolean) => void; titleId: string; }

/** 对话框按钮基础样式（与 components/ui/button.tsx 的 Apple 按钮语言一致） */
const btnBase =
  "inline-flex h-8 shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control px-3.5 text-ui font-medium leading-none transition-[background-color,box-shadow,transform] duration-150 ease-[var(--ds-ease-out)] outline-none active:scale-[0.97] focus-visible:ring-[3px] focus-visible:ring-ring";
const Ctx = createContext<Ctx>({ open: false, setOpen: () => {}, titleId: "" });

function AlertDialog({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (v: boolean) => void; children: ReactNode }) {
  const [inner, setInner] = useState(false);
  const titleId = useId();
  const value = useMemo<Ctx>(() => ({ open: open ?? inner, setOpen: (v) => { if (open === undefined) setInner(v); onOpenChange?.(v); }, titleId }), [open, inner, onOpenChange, titleId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function AlertDialogTrigger({ asChild = true, children, className, onClick, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { setOpen } = useContext(Ctx);
  // ⚠️ onClick 必须**组合**而不是被 props 覆盖：调用方（ConfirmModal 等）总会传
  // `onClick={(e) => e.stopPropagation()}`，旧写法 `{ ..., onClick: 开弹窗, ...props }`
  // 让 props 里的 onClick 把开弹窗顶掉 —— 确认弹窗永远不弹出（历史 bug）。
  const p = { type: "button" as const, className, ...props, onClick: (e: React.MouseEvent<HTMLButtonElement>) => { onClick?.(e); e.stopPropagation(); setOpen(true); } };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

function AlertDialogContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
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
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId || undefined}
        tabIndex={-1}
        className={cn(
          "material-popover relative z-10 w-full max-w-md rounded-sheet hairline border-shell-border-l2 p-6 shadow-elevation-3 outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

const AlertDialogHeader = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn("mb-4 flex flex-col gap-1 text-center", className)}>{children}</div>;
const AlertDialogFooter = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn("mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}>{children}</div>;
function AlertDialogTitle({ className, children }: { className?: string; children: ReactNode }) {
  const { titleId } = useContext(Ctx);
  return <h2 id={titleId} className={cn("text-lead font-semibold leading-6 tracking-[-0.01em] text-shell-label-primary", className)}>{children}</h2>;
}
const AlertDialogDescription = ({ className, children }: { className?: string; children: ReactNode }) => <p className={cn("text-ui leading-5 text-shell-label-tertiary", className)}>{children}</p>;

function AlertDialogAction({ asChild = true, children, className, variant = "default", onClick, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; variant?: "default" | "destructive"; children: ReactNode }) {
  const { setOpen } = useContext(Ctx);
  const tone = variant === "destructive"
    ? "bg-destructive text-white hover:bg-[color-mix(in_srgb,var(--destructive)_88%,black)]"
    : "bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)]";
  // 同 Trigger：确认回调与关弹窗都要跑，不能让 onClick 把关弹窗顶掉
  const p = { type: "button" as const, className: cn(btnBase, tone, className), ...props, onClick: (e: React.MouseEvent<HTMLButtonElement>) => { onClick?.(e); e.stopPropagation(); setOpen(false); } };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

function AlertDialogCancel({ asChild = true, children, className, onClick, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { setOpen } = useContext(Ctx);
  const p = { type: "button" as const, className: cn(btnBase, "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_80%,var(--foreground))]", className), ...props, onClick: (e: React.MouseEvent<HTMLButtonElement>) => { onClick?.(e); e.stopPropagation(); setOpen(false); } };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

const AlertDialogPortal = ({ children }: { children: ReactNode }) => <>{children}</>;
const AlertDialogOverlay = ({ className }: { className?: string }) => <div className={cn("fixed inset-0 z-modal bg-black/25 backdrop-blur-[2px] dark:bg-black/45", className)} />;

export { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel, AlertDialogPortal, AlertDialogOverlay };
