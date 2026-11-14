// 共用的 shiki 高亮器工厂（编辑器侧与 AI 正文侧各取所需）。
//
// 只放「怎么装一台裁剪过高亮器」这一件事：语言/主题的 loader 表 +
// createBundledHighlighter 的配置。两侧的差异（BlockNote 扩展 vs React token 渲染）
// 各自留在自己的模块里，避免 AI 正文为了复用 loader 把 @blocknote/core 拖进 chunk。
//
// 用 @shikijs/langs-precompiled（JS 正则引擎，无 WASM）+ 逐语言动态 import：
// 只有真的出现某语言的代码块才下载对应 chunk，未列出的语言退化为纯文本。
import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import { HIGHLIGHT_LANGS } from "./highlight-langs";

/** 明暗两套主题（与 @blocknote/code-block 默认一致，避免观感漂移）。 */
export const HIGHLIGHT_THEMES = ["github-dark", "github-light"] as const;

const moduleLoaders = {
  javascript: () => import("@shikijs/langs-precompiled/javascript"),
  typescript: () => import("@shikijs/langs-precompiled/typescript"),
  jsx: () => import("@shikijs/langs-precompiled/jsx"),
  tsx: () => import("@shikijs/langs-precompiled/tsx"),
  json: () => import("@shikijs/langs-precompiled/json"),
  python: () => import("@shikijs/langs-precompiled/python"),
  bash: () => import("@shikijs/langs-precompiled/bash"),
  sql: () => import("@shikijs/langs-precompiled/sql"),
  html: () => import("@shikijs/langs-precompiled/html"),
  css: () => import("@shikijs/langs-precompiled/css"),
  markdown: () => import("@shikijs/langs-precompiled/markdown"),
  yaml: () => import("@shikijs/langs-precompiled/yaml"),
  go: () => import("@shikijs/langs-precompiled/go"),
  rust: () => import("@shikijs/langs-precompiled/rust"),
  java: () => import("@shikijs/langs-precompiled/java"),
  c: () => import("@shikijs/langs-precompiled/c"),
  cpp: () => import("@shikijs/langs-precompiled/cpp"),
  diff: () => import("@shikijs/langs-precompiled/diff"),
} satisfies Record<(typeof HIGHLIGHT_LANGS)[number], () => Promise<unknown>>;

/**
 * 语言 loader 表。别名也指向同一个模块（shiki 按 key 去重，不会重复下载），
 * 这样编辑器侧按 BlockNote 的语言 id 加载、正文侧按归一后的规范名加载都能命中。
 */
export const highlightLangLoaders = {
  ...moduleLoaders,
  // 别名（与 lib/highlight-langs.ts 的 LANG_ALIASES 保持一致）
  js: moduleLoaders.javascript,
  ts: moduleLoaders.typescript,
  sh: moduleLoaders.bash,
  shell: moduleLoaders.bash,
  py: moduleLoaders.python,
  yml: moduleLoaders.yaml,
  md: moduleLoaders.markdown,
  rs: moduleLoaders.rust,
} satisfies Record<string, () => Promise<unknown>>;

export const highlightThemeLoaders = {
  "github-dark": () => import("@shikijs/themes/github-dark"),
  "github-light": () => import("@shikijs/themes/github-light"),
} satisfies Record<(typeof HIGHLIGHT_THEMES)[number], () => Promise<unknown>>;

/** 高亮器工厂：调用方传入要预热的主题与语言（懒加载仍然由 loader 决定）。 */
export const createLotionHighlighter = createBundledHighlighter<string, string>({
  langs: highlightLangLoaders,
  themes: highlightThemeLoaders,
  // precompiled 语法用 JS 正则引擎（无 WASM，避免 CSP / 加载器问题）
  engine: () => createJavaScriptRegexEngine(),
});
