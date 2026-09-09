"use client";

// 自研 UI 基础件（对齐 DSH ui-primitives 设计）：
// Slot —— asChild 语义（克隆子元素并合并 props）；
// Floating —— 锚点浮动层（fixed 定位 + 视口夹取 + 外部点击/Escape 关闭），
// 供 dropdown-menu / popover 复用，不依赖任何第三方弹层库。
import { Children, cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

/** asChild 语义：把 props 合并到唯一子元素（不包裹额外节点）。
 *  兜底：asChild 但子节点不是单个元素（例如直接写文本 "Cancel"）时，
 *  渲染原生 button 而不是静默返回 null——否则按钮会凭空消失。 */
export function Slot({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) {
  const child = Children.only(children);
  if (!isValidElement(child)) {
    return (
      <button type="button" {...(props as React.ComponentProps<"button">)}>
        {children}
      </button>
    );
  }
  const childProps = (child.props as Record<string, unknown>) ?? {};
  return cloneElement(child as ReactElement, { ...props, ...childProps });
}

export interface FloatingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  side?: "bottom" | "top" | "right" | "left";
  align?: "start" | "end" | "center";
  className?: string;
  children: ReactNode;
}

/** 锚点浮动层：trigger 渲染在锚点包装内，内容 fixed 定位贴锚点，自动夹取视口边界 */
export function Floating({ open, onOpenChange, trigger, side = "bottom", align = "start", className, children }: FloatingProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 打开时定位（内容挂载后测量），滚动/缩放时跟随锚点
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      const el = contentRef.current;
      if (!r || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
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
  }, [open, side, align]);

  // 外部点击 / Escape 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) === true) return;
      if (contentRef.current?.contains(t) === true) return;
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        {trigger}
      </span>
      {open && (
        <div
          ref={contentRef}
          role="menu"
          style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, zIndex: 99999, visibility: pos ? "visible" : "hidden" }}
          className={className}
        >
          {children}
        </div>
      )}
    </>
  );
}
