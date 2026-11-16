import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";

function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery();
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return mediaQuery()?.matches ?? false;
}

/** 触屏设备使用更宽松的命中区与列表行高。 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
