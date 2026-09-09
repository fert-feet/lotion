"use client";

// 懒加载包装：把 AI 面板 / 全局搜索这类大块依赖切出首屏 chunk，打开时再拉取。
// 迁移自 next/dynamic（{ ssr:false }）——SPA 无 SSR 阶段，React.lazy + Suspense 等价。
import { Suspense, lazy } from "react";

const AiPanel = lazy(() => import("./ai-panel"));
const SearchCommand = lazy(() => import("@/components/search-command"));

export function LazyAiPanel() {
  return (
    <Suspense fallback={null}>
      <AiPanel />
    </Suspense>
  );
}

export function LazySearchCommand() {
  return (
    <Suspense fallback={null}>
      <SearchCommand />
    </Suspense>
  );
}
