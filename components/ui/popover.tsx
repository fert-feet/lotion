"use client";

// 自研 Popover：与 DropdownMenu 同构的浮动卡片（portal + trigger rect 定位）
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Slot } from "./_primitives";

interface PopoverCtx { open: boolean; setOpen: (v: boolean) => void; setTriggerEl: (el: HTMLButtonElement | null) => void; getTriggerEl: () => HTMLButtonElement | null; }
const Ctx = createContext<PopoverCtx>({ open: false, setOpen: () => {}, setTriggerEl: () => {}, getTriggerEl: () => null });

function Popover({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (v: boolean) => void; children: ReactNode }) {
  const [inner, setInner] = useState(false);
  const el = useRef<HTMLButtonElement | null>(null);
  const value = useMemo<PopoverCtx>(() => ({
    open: open ?? inner,
    setOpen: (v) => { if (open === undefined) setInner(v); onOpenChange?.(v); },
    setTriggerEl: (node) => { el.current = node; },
    getTriggerEl: () => el.current,
  }), [open, inner, onOpenChange]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function PopoverTrigger({ asChild = true, children, className, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { open, setOpen, setTriggerEl } = useContext(Ctx);
  const p = { type: "button" as const, className, ref: setTriggerEl, onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpen(!open); }, ...props };
  if (asChild) return <Slot {...p}>{children}</Slot>;
  return <button {...p}>{children}</button>;
}

function PopoverContent({ className, align = "center", side = "bottom", sideOffset = 4, alignOffset: _alignOffset, forceMount: _forceMount, children, ...props }: HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" | "center"; side?: "bottom" | "top" | "right" | "left"; sideOffset?: number; alignOffset?: number; forceMount?: boolean; children: ReactNode }) {
  const { open, setOpen, getTriggerEl } = useContext(Ctx);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // SSR 水合门控：服务端不渲染 portal，挂载后再出现
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const trigger = getTriggerEl();
      const content = contentRef.current;
      if (!trigger || !content) return;
      const r = trigger.getBoundingClientRect();
      const w = content.offsetWidth;
      const h = content.offsetHeight;
      let top = side === "bottom" ? r.bottom + sideOffset : r.top - h - sideOffset;
      let left = r.left + (r.width - w) / 2;
      if (align === "start") left = r.left;
      else if (align === "end") left = r.right - w;
      const M = 8;
      top = Math.min(Math.max(top, M), window.innerHeight - h - M);
      left = Math.min(Math.max(left, M), window.innerWidth - w - M);
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, side, align, sideOffset, getTriggerEl]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      const trigger = getTriggerEl();
      if (trigger && trigger.contains(t)) return;
      if (contentRef.current?.contains(t) === true) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, setOpen, getTriggerEl]);
  if (!mounted) return null;
  if (!open) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={contentRef} style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, zIndex: 99999, visibility: pos ? "visible" : "hidden" }} className={cn("material-popover w-72 rounded-[12px] border-[0.5px] border-shell-border-l2 shadow-[var(--shadow-md)]", className)} {...props}>
      {children}
    </div>,
    document.body,
  );
}

const PopoverAnchor = ({ children }: { children?: ReactNode }) => <>{children}</>;
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };