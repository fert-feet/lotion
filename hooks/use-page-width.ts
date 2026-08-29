"use client";

// 页面宽度设置（对标 Notion narrow/wide）：narrow（max-w-3xl）↔ wide（max-w-5xl）。
// localStorage 持久化，跨页面生效。
import { create } from "zustand";

export type PageWidth = "narrow" | "wide";

const STORAGE_KEY = "lotion-page-width";

function readInitial(): PageWidth {
  if (typeof window === "undefined") return "narrow";
  return window.localStorage.getItem(STORAGE_KEY) === "wide" ? "wide" : "narrow";
}

type PageWidthStore = {
  pageWidth: PageWidth;
  togglePageWidth: () => void;
};

const usePageWidth = create<PageWidthStore>((set) => ({
  pageWidth: readInitial(),
  togglePageWidth: () =>
    set((s) => {
      const next: PageWidth = s.pageWidth === "narrow" ? "wide" : "narrow";
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
      return { pageWidth: next };
    }),
}));

export default usePageWidth;
