import { useCallback, useEffect, useRef } from "react";

type Orientation = "horizontal" | "vertical";

const CONTROL_SELECTOR =
  'button:not([disabled]), input:not([disabled]):not([type="hidden"]), [role="button"]:not([aria-disabled="true"]), a[href]:not([aria-disabled="true"])';

function supportsFocusGroup(): boolean {
  return typeof HTMLElement !== "undefined" && "focusGroup" in HTMLElement.prototype;
}

/**
 * Toolbar 的 fallback 实现：原生 focusgroup 可用时完全交给浏览器，
 * 否则维护一个 roving tabindex、方向键与 Home/End。
 */
export function useRovingToolbar(orientation: Orientation, enabled = true) {
  const ref = useRef<HTMLDivElement | null>(null);
  const activeIndex = useRef(0);

  const controls = useCallback((): HTMLElement[] => {
    const root = ref.current;
    if (!root) return [];
    return [...new Set(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))];
  }, []);

  const syncTabStops = useCallback((focusIndex?: number) => {
    if (supportsFocusGroup()) return;
    const items = controls();
    if (items.length === 0) return;
    const next = focusIndex === undefined
      ? Math.min(activeIndex.current, items.length - 1)
      : Math.max(0, Math.min(focusIndex, items.length - 1));
    activeIndex.current = next;
    items.forEach((item, index) => {
      item.tabIndex = index === next ? 0 : -1;
    });
  }, [controls]);

  useEffect(() => {
    if (!enabled) return;
    syncTabStops();
    const root = ref.current;
    if (!root || supportsFocusGroup()) return;
    const observer = new MutationObserver(() => syncTabStops());
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled, orientation, syncTabStops]);

  const onFocusCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const items = controls();
    const index = items.indexOf(event.target as HTMLElement);
    if (index >= 0) syncTabStops(index);
  }, [controls, syncTabStops]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (supportsFocusGroup()) return;
    const items = controls();
    if (items.length === 0) return;
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const horizontal = orientation === "horizontal";
    const rtl = horizontal && getComputedStyle(ref.current!).direction === "rtl";
    let next: number | null = null;

    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (horizontal && event.key === "ArrowRight") next = (current + (rtl ? -1 : 1) + items.length) % items.length;
    else if (horizontal && event.key === "ArrowLeft") next = (current + (rtl ? 1 : -1) + items.length) % items.length;
    else if (!horizontal && event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (!horizontal && event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;

    if (next === null) return;
    event.preventDefault();
    syncTabStops(next);
    items[next]?.focus({ preventScroll: true });
  }, [controls, orientation, syncTabStops]);

  return { ref, onFocusCapture, onKeyDown };
}
