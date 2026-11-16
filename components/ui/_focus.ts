"use client";

// 浮层的键盘/焦点行为（Dialog / AlertDialog / Popover 共用）。
//
// 之前三套浮层都只处理了 Escape：打开不聚焦、Tab 会跑出弹窗、关闭后焦点丢在 body 上
// —— 键盘用户与读屏用户打开确认框后既不知道焦点在哪，也回不到触发按钮。
// 这里把三件事集中到一处：
//   1. 打开时聚焦面板内第一个可聚焦元素（没有则聚焦面板本身，tabIndex=-1）；
//   2. trap=true 时 Tab/Shift+Tab 在面板内循环（模态弹窗语义）；
//   3. 关闭时把焦点还给打开前的元素。
import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[role="menuitem"]:not([aria-disabled="true"])',
].join(",");

function focusables(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getAttribute("aria-hidden") !== "true",
  );
}

export function useDialogFocus(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  options: { trap?: boolean } = {},
) {
  const { trap = true } = options;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node ? focusables(node)[0] ?? node : null;
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !trap || !node) return;
      const items = focusables(node);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === head || active === node)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && active === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      // 触发按钮可能已卸载（例如删除后列表刷新）—— 只在仍连着文档时还原
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, ref, trap]);
}
