// 高亮语言的单一真相源（**零依赖**：不 import shiki，也不 import @blocknote）。
//
// 为什么单独一个文件：语言表有两个消费者——
//   · 编辑器侧 `lib/code-highlight.ts`（要 shiki 的 loader 表 + BlockNote 扩展）
//   · AI 正文侧 `lib/markdown-highlight.ts`（要按需懒加载 shiki）
// 而渲染器 `components/markdown/render.tsx` 只需要「这个围栏语言认不认识」。
// 把纯数据抽出来，渲染层就不必为了一个别名表把 shiki 拉进首屏 chunk。

/** 支持高亮的规范语言名（= @shikijs/langs-precompiled 的模块名）。 */
export const HIGHLIGHT_LANGS = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "python",
  "bash",
  "sql",
  "html",
  "css",
  "markdown",
  "yaml",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "diff",
] as const;

export type HighlightLang = (typeof HIGHLIGHT_LANGS)[number];

/** 围栏语言标识的别名（模型经常写 js / ts / sh / yml / md / rs）。 */
const LANG_ALIASES: Readonly<Record<string, HighlightLang>> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  "c++": "cpp",
  cxx: "cpp",
};

/** 明确「不需要高亮」的标识：认出来就退化为纯文本，而不是当未知语言。 */
const PLAIN_LANGS = new Set(["", "text", "txt", "plain", "plaintext", "output", "log"]);

const CANONICAL = new Set<string>(HIGHLIGHT_LANGS);

/**
 * 把围栏 info string 归一为规范语言名。
 * @param info - 围栏后的原始信息串（可能带标题、行号等附加信息）。
 * @returns 规范语言名；不认识 / 明确纯文本时返回 `null`。
 */
export function normalizeFenceLang(info: string | undefined): HighlightLang | null {
  if (info === undefined) return null;
  // 只取第一个 token：```ts title="x.ts" 里的附加信息忽略
  const token = info.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (PLAIN_LANGS.has(token)) return null;
  if (CANONICAL.has(token)) return token as HighlightLang;
  return LANG_ALIASES[token] ?? null;
}
