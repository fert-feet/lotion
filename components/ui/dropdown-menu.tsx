"use client";

// 自研 DropdownMenu（对齐 DSH Menu 设计）：
// 受控/非受控下拉；内容经 createPortal 挂到 body，按 trigger rect 定位并夹取视口，
// 外部点击 / Escape 关闭；trigger 支持 asChild（ref 经 Slot 合并）。
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Slot } from "./_primitives";

interface MenuContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  setTriggerEl: (el: HTMLButtonElement | null) => void;
  getTriggerEl: () => HTMLButtonElement | null;
  triggerId: string;
  menuId: string;
  setEnterOnOpen: (value: boolean) => void;
  consumeEnterOnOpen: () => boolean;
}
const MenuContext = createContext<MenuContextValue>({
  open: false,
  setOpen: () => {},
  setTriggerEl: () => {},
  getTriggerEl: () => null,
  triggerId: "",
  menuId: "",
  setEnterOnOpen: () => {},
  consumeEnterOnOpen: () => false,
});

function DropdownMenu({ open, onOpenChange, children }: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const triggerEl = useRef<HTMLButtonElement | null>(null);
  const enterOnOpen = useRef(false);
  const generatedId = useId();
  const triggerId = `dropdown-trigger-${generatedId}`;
  const menuId = `dropdown-menu-${generatedId}`;
  const value = useMemo<MenuContextValue>(() => ({
    open: open ?? innerOpen,
    setOpen: (v) => { if (open === undefined) setInnerOpen(v); onOpenChange?.(v); },
    setTriggerEl: (el) => { triggerEl.current = el; },
    getTriggerEl: () => triggerEl.current,
    triggerId,
    menuId,
    setEnterOnOpen: (value) => { enterOnOpen.current = value; },
    consumeEnterOnOpen: () => {
      const value = enterOnOpen.current;
      enterOnOpen.current = false;
      return value;
    },
  }), [open, innerOpen, onOpenChange, triggerId, menuId]);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

function useMenu() {
  return useContext(MenuContext);
}

function DropdownMenuTrigger({ asChild = true, children, className, ...props }: HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: ReactNode }) {
  const { open, setOpen, setTriggerEl, triggerId, menuId, setEnterOnOpen } = useMenu();
  const triggerProps = {
    id: triggerId,
    type: "button" as const,
    className,
    ref: setTriggerEl,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      setEnterOnOpen(e.detail === 0);
      setOpen(!open);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== "ArrowDown") return;
      e.preventDefault();
      if (!open) {
        setEnterOnOpen(true);
        setOpen(true);
        return;
      }
      document.getElementById(menuId)?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    },
    "aria-haspopup": "menu" as const,
    "aria-expanded": open || undefined,
    "aria-controls": menuId,
    ...props,
  };
  if (asChild) return <Slot {...triggerProps}>{children}</Slot>;
  return <button {...triggerProps}>{children}</button>;
}

function DropdownMenuContent({ className, align = "start", side = "bottom", forceMount: _forceMount, alignOffset: _alignOffset, sideOffset: _sideOffset, children, onKeyDown, ...props }: HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" | "center"; side?: "bottom" | "top" | "right" | "left"; forceMount?: boolean; alignOffset?: number; sideOffset?: number; children: ReactNode }) {
  const { open, setOpen, getTriggerEl, triggerId, menuId, consumeEnterOnOpen } = useMenu();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // SSR 水合门控：服务端不渲染 portal，挂载后再出现（避免 forceMount 下 HTML 不一致）
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Popover 是渐进增强：支持时把菜单提升到 top layer，不支持时仍是固定定位浮层。
  useEffect(() => {
    if (!open || !mounted) return;
    const node = contentRef.current;
    if (!node || typeof node.showPopover !== "function") return;
    if (!node.matches(":popover-open")) node.showPopover();
    return () => {
      if (node.isConnected && node.matches(":popover-open")) node.hidePopover();
    };
  }, [mounted, open]);

  useEffect(() => {
    if (!open || !mounted) return;
    const trigger = getTriggerEl();
    const content = contentRef.current;
    const first = content?.querySelector<HTMLElement>('[role="menuitem"]');
    if (consumeEnterOnOpen()) first?.focus();
    else trigger?.focus({ preventScroll: true });

    return () => {
      const active = document.activeElement;
      if (content?.contains(active)) {
        trigger?.focus({ preventScroll: true });
      }
    };
  }, [consumeEnterOnOpen, getTriggerEl, mounted, open]);

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
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Node;
      if (getTriggerEl()?.contains(target) || contentRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, setOpen, getTriggerEl]);

  if (!mounted) return null;
  if (!open && !_forceMount) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={contentRef}
      id={menuId}
      role="menu"
      aria-labelledby={triggerId}
      {...({ popover: "manual" } as React.HTMLAttributes<HTMLDivElement>)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const items = [...(contentRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          items[(current + 1 + items.length) % items.length]?.focus();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          items[(current - 1 + items.length) % items.length]?.focus();
        } else if (event.key === "Home") {
          event.preventDefault();
          items[0]?.focus();
        } else if (event.key === "End") {
          event.preventDefault();
          items[items.length - 1]?.focus();
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          (document.activeElement as HTMLElement | null)?.click();
        } else if (event.key === "Tab") {
          getTriggerEl()?.focus({ preventScroll: true });
          setOpen(false);
        }
      }}
      style={{
        position: "fixed",
        inset: "auto",
        margin: 0,
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        zIndex: "var(--z-popover)",
        visibility: pos ? "visible" : "hidden",
      }}
      className={cn("dropdown-menu-popover material-popover max-h-80 min-w-[9rem] overflow-y-auto rounded-card hairline border-shell-border-l2 p-1 shadow-elevation-2", className)}
      {...props}
    >
      {children}
    </div>,
    document.body,
  );
}

function DropdownMenuItem({ className, children, onClick, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { setOpen } = useMenu();
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(false);
      }}
      className={cn("flex cursor-pointer select-none items-center gap-2 rounded-control px-2 py-[5px] text-left text-ui leading-[18px] text-shell-label-primary outline-none transition-colors hover:bg-shell-row-hover focus:bg-shell-row-hover disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0", className)}
      {...props}
    >
      {children}
    </button>
  );
}

function DropdownMenuSeparator({ className }: { className?: string }) {
  return <hr role="separator" className={cn("my-1 h-px border-0 bg-border", className)} />;
}

const DropdownMenuGroup = ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>;
const DropdownMenuLabel = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("px-2 py-1 text-caption font-medium text-shell-label-tertiary", className)}>{children}</div>;
const DropdownMenuPortal = ({ children }: { children: ReactNode }) => <>{children}</>;
const DropdownMenuSub = ({ children }: { children: ReactNode }) => <>{children}</>;
const DropdownMenuSubTrigger = ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>;
const DropdownMenuSubContent = ({ children }: { children: ReactNode }) => <>{children}</>;
const DropdownMenuShortcut = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => <span className={cn("ml-auto text-caption tracking-wide text-shell-label-tertiary", className)} {...props} />;

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuGroup, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuShortcut,
};
