"use client";

// 自研 DropdownMenu（对齐 DSH Menu 设计）：
// 受控/非受控下拉；内容经 createPortal 挂到 body，按 trigger rect 定位并夹取视口，
// 外部点击 / Escape 关闭；trigger 支持 asChild（ref 经 Slot 合并）。
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Slot } from "./_primitives";

interface MenuContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  setTriggerEl: (el: HTMLButtonElement | null) => void;
  getTriggerEl: () => HTMLButtonElement | null;
}
const MenuContext = createContext<MenuContextValue>({ open: false, setOpen: () => {}, setTriggerEl: () => {}, getTriggerEl: () => null });

function DropdownMenu({ open, onOpenChange, children }: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const triggerEl = useRef<HTMLButtonElement | null>(null);
  const value = useMemo<MenuContextValue>(() => ({
    open: open ?? innerOpen,
    setOpen: (v) => { if (open === undefined) setInnerOpen(v); onOpenChange?.(v); },
    setTriggerEl: (el) => { triggerEl.current = el; },
    getTriggerEl: () => triggerEl.current,
  }), [open, innerOpen, onOpenChange]);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

function useMenu() {
  return useContext(MenuContext);
}

function DropdownMenuTrigger({ asChild = true, children, className, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { open, setOpen, setTriggerEl } = useMenu();
  const triggerProps = {
    type: "button" as const,
    className,
    ref: setTriggerEl,
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpen(!open); },
    "aria-expanded": open || undefined,
    ...props,
  };
  if (asChild) return <Slot {...triggerProps}>{children}</Slot>;
  return <button {...triggerProps}>{children}</button>;
}

function DropdownMenuContent({ className, align = "start", side = "bottom", forceMount: _forceMount, alignOffset: _alignOffset, sideOffset: _sideOffset, children, ...props }: HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" | "center"; side?: "bottom" | "top" | "right" | "left"; forceMount?: boolean; alignOffset?: number; sideOffset?: number; children: ReactNode }) {
  const { open, setOpen, getTriggerEl } = useMenu();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // SSR 水合门控：服务端不渲染 portal，挂载后再出现（避免 forceMount 下 HTML 不一致）
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      // trigger 元素在 context 里经 ref 注册（避免 content 定位到包装层）
      const trigger = getTriggerEl();
      const content = contentRef.current;
      if (!trigger || !content) return;
      const r = trigger.getBoundingClientRect();
      const w = content.offsetWidth;
      const h = content.offsetHeight;
      const GAP = 4;
      let top = r.bottom + GAP;
      let left = r.left;
      if (side === "top") top = r.top - h - GAP;
      else if (side === "right") { left = r.right + GAP; top = r.top; }
      else if (side === "left") { left = r.left - w - GAP; top = r.top; }
      if (align === "end") left = r.right - w;
      else if (align === "center") left = r.left + (r.width - w) / 2;
      const M = 8;
      top = Math.min(Math.max(top, M), window.innerHeight - h - M);
      left = Math.min(Math.max(left, M), window.innerWidth - w - M);
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, side, align, getTriggerEl]);

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
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, getTriggerEl]);

  if (!mounted) return null;
  if (!open && !_forceMount) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={contentRef}
      style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, zIndex: 99999, visibility: pos ? "visible" : "hidden" }}
      className={cn("max-h-80 min-w-[8rem] overflow-y-auto rounded-xl border border-shell-border-l2 bg-popover p-1 shadow-lg", className)}
      {...props}
    >
      {children}
    </div>,
    document.body,
  );
}

function DropdownMenuItem({ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { disabled?: boolean }) {
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      className={cn("flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm leading-5 text-shell-label-primary outline-none hover:bg-shell-row-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("-mx-1 my-1 h-px bg-shell-border-l2", className)} />;
}

const DropdownMenuGroup = ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>;
const DropdownMenuLabel = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("px-2.5 py-1.5 text-xs text-shell-label-tertiary", className)}>{children}</div>;
const DropdownMenuPortal = ({ children }: { children: ReactNode }) => <>{children}</>;
const DropdownMenuSub = ({ children }: { children: ReactNode }) => <>{children}</>;
const DropdownMenuSubTrigger = ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>;
const DropdownMenuSubContent = ({ children }: { children: ReactNode }) => <>{children}</>;
const DropdownMenuShortcut = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => <span className={cn("ml-auto text-xs tracking-widest opacity-60", className)} {...props} />;

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuGroup, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuShortcut,
};