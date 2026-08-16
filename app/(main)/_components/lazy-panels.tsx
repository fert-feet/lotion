"use client";

// 懒加载包装（客户端组件）：ssr:false 的 next/dynamic 只能在客户端组件中使用，
// 服务端布局 (main)/layout.tsx 经本组件按需加载大块依赖。
import dynamic from "next/dynamic";

// 按需加载：AiPanel（含 react-markdown ~1.5MB）与 SearchCommand（cmdk）默认关闭，
// 首屏不加载其 chunk，打开时再拉取（ssr:false → SSR 阶段不执行，只渲染 fallback）
const AiPanel = dynamic(() => import("./ai-panel"), { ssr: false });
const SearchCommand = dynamic(() => import("../../../components/search-command"), { ssr: false });

export function LazyAiPanel() {
  return <AiPanel />;
}

export function LazySearchCommand() {
  return <SearchCommand />;
}
