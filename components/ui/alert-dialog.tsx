"use client";

// AlertDialog —— 与 Dialog 同一套 macOS sheet 语言（危险操作确认）
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Slot } from "./_primitives";

interface Ctx { open: boolean; setOpen: (v: boolean) => void; }
const Ctx = createContext<Ctx>({ open: false, setOpen: () => {} });

function AlertDialog({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (v: boolean) => void; children: ReactNode }) {
  const [inner, setInner] = useState(false);
  const value = useMemo<Ctx>(() => ({ open: open ?? inner, setOpen: (v) => { if (open === undefined) setInner(v); onOpenChange?.(v); } }), [open, inner, onOpenChange]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function AlertDialogTrigger({ asChild = true, children, className, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { setOpen } = useContext(Ctx);
  const p = { type: "button" as const, className, onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpen(true); }, ...props };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

function AlertDialogContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
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
          "material-popover relative z-10 w-full max-w-md rounded-[16px] border-[0.5px] border-shell-border-l2 p-6 shadow-[var(--shadow-lg)]",
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
const AlertDialogTitle = ({ className, children }: { className?: string; children: ReactNode }) => <h2 className={cn("text-[15px] font-semibold leading-6 tracking-[-0.01em] text-shell-label-primary", className)}>{children}</h2>;
const AlertDialogDescription = ({ className, children }: { className?: string; children: ReactNode }) => <p className={cn("text-[13px] leading-5 text-shell-label-tertiary", className)}>{children}</p>;

function AlertDialogAction({ asChild = true, children, className, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { setOpen } = useContext(Ctx);
  const p = { type: "button" as const, className, onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpen(false); }, ...props };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

function AlertDialogCancel({ asChild = true, children, className, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { setOpen } = useContext(Ctx);
  const p = { type: "button" as const, className, onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpen(false); }, ...props };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

const AlertDialogPortal = ({ children }: { children: ReactNode }) => <>{children}</>;
const AlertDialogOverlay = ({ className }: { className?: string }) => <div className={cn("fixed inset-0 z-[99999] bg-black/25 backdrop-blur-[2px] dark:bg-black/45", className)} />;

export { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel, AlertDialogPortal, AlertDialogOverlay };
