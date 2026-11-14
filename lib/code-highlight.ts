// 代码块语法高亮（编辑器侧）：自建 shiki 高亮器，只打包白名单语言。
//
// 背景：@blocknote/code-block 导出的 `syntaxHighlighter` 是一个**固定**的 bundled
// highlighter，里面写死了几十种语言的动态 import（cpp 单个语法包 1 MB，
// php / objective-c / less / csharp 各 100 KB+）。它的 `codeBlockOptions.supportedLanguages`
// 只影响下拉框，不影响打包——所以裁剪语言表必须自建 highlighter。
//
// 这里用 @shikijs/langs-precompiled（JS 正则引擎，无 WASM）按需加载：
// 只有真的渲染了某语言的代码块，才下载对应 chunk；未列出的语言退化为纯文本。
import { SyntaxHighlightingExtension, type CodeBlockOptions } from "@blocknote/core";
import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

/** 支持高亮的语言（对应 @shikijs/langs-precompiled 的模块名，也是 md 围栏的语言标识）。 */
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

/**
 * 代码块的语言下拉表（名字 + 别名 + 下拉里的语言 id）。
 * 注意：这不影响打包——真正决定打包体积的是上面的 langLoaders。
 * 这里自己写而不用 @blocknote/code-block 的 codeBlockOptions，是因为那个模块
 * 一旦被 import 就会把它内置的**固定** highlighter（几十种语言）带进产物。
 */
export const lotionCodeBlockOptions: CodeBlockOptions = {
  defaultLanguage: "text",
  supportedLanguages: {
    text: { name: "Plain Text", aliases: ["text", "txt", "plain"] },
    javascript: { name: "JavaScript", aliases: ["javascript", "js"] },
    typescript: { name: "TypeScript", aliases: ["typescript", "ts"] },
    jsx: { name: "JSX", aliases: ["jsx"] },
    tsx: { name: "TSX", aliases: ["tsx"] },
    json: { name: "JSON", aliases: ["json"] },
    python: { name: "Python", aliases: ["python", "py"] },
    bash: { name: "Bash", aliases: ["bash", "sh", "shell"] },
    sql: { name: "SQL", aliases: ["sql"] },
    html: { name: "HTML", aliases: ["html"] },
    css: { name: "CSS", aliases: ["css"] },
    markdown: { name: "Markdown", aliases: ["markdown", "md"] },
    yaml: { name: "YAML", aliases: ["yaml", "yml"] },
    go: { name: "Go", aliases: ["go"] },
    rust: { name: "Rust", aliases: ["rust", "rs"] },
    java: { name: "Java", aliases: ["java"] },
    c: { name: "C", aliases: ["c"] },
    cpp: { name: "C++", aliases: ["cpp", "c++"] },
    diff: { name: "Diff", aliases: ["diff"] },
  },
};

/** 明暗两套主题（与 @blocknote/code-block 默认一致，避免观感漂移）。 */
export const HIGHLIGHT_THEMES = ["github-dark", "github-light"] as const;

/**
 * 语言加载表。别名与规范名指向同一个 chunk（shiki 按 key 去重）。
 * 新增语言：在此加一行 + 在 HIGHLIGHT_LANGS 里加名字。
 */
const langLoaders = {
  javascript: () => import("@shikijs/langs-precompiled/javascript"),
  typescript: () => import("@shikijs/langs-precompiled/typescript"),
  jsx: () => import("@shikijs/langs-precompiled/jsx"),
  tsx: () => import("@shikijs/langs-precompiled/tsx"),
  json: () => import("@shikijs/langs-precompiled/json"),
  python: () => import("@shikijs/langs-precompiled/python"),
  bash: () => import("@shikijs/langs-precompiled/bash"),
  shell: () => import("@shikijs/langs-precompiled/shell"),
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
  // 别名
  js: () => import("@shikijs/langs-precompiled/javascript"),
  ts: () => import("@shikijs/langs-precompiled/typescript"),
  sh: () => import("@shikijs/langs-precompiled/bash"),
  py: () => import("@shikijs/langs-precompiled/python"),
  yml: () => import("@shikijs/langs-precompiled/yaml"),
  md: () => import("@shikijs/langs-precompiled/markdown"),
  rs: () => import("@shikijs/langs-precompiled/rust"),
} satisfies Record<string, () => Promise<unknown>>;

const themeLoaders = {
  "github-dark": () => import("@shikijs/themes/github-dark"),
  "github-light": () => import("@shikijs/themes/github-light"),
} satisfies Record<string, () => Promise<unknown>>;

const createHighlighter = createBundledHighlighter<string, string>({
  langs: langLoaders,
  themes: themeLoaders,
  // precompiled 语法用 JS 正则引擎（无 WASM，避免 CSP / 加载器问题）
  engine: () => createJavaScriptRegexEngine(),
});

/** 编辑器 extensions 用的高亮扩展（懒加载：创建 highlighter 时才解析 chunk）。 */
export const lotionSyntaxHighlighter = SyntaxHighlightingExtension({
  createHighlighter: () =>
    createHighlighter({
      themes: [...HIGHLIGHT_THEMES],
      langs: [],
    }),
});
