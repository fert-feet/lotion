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
import { HIGHLIGHT_THEMES, createLotionHighlighter } from "./highlight-shared";

// 语言表与 loader 表在 lib/highlight-langs.ts / lib/highlight-shared.ts：
// AI 正文侧（lib/markdown-highlight.ts）复用同一份表，但不该被拖进 @blocknote/core。
export { HIGHLIGHT_LANGS } from "./highlight-langs";
export { HIGHLIGHT_THEMES } from "./highlight-shared";

/**
 * 代码块的语言下拉表（名字 + 别名 + 下拉里的语言 id）。
 * 注意：这不影响打包——真正决定打包体积的是 highlight-shared 的 loader 表。
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

/** 编辑器 extensions 用的高亮扩展（懒加载：创建 highlighter 时才解析 chunk）。 */
export const lotionSyntaxHighlighter = SyntaxHighlightingExtension({
  createHighlighter: () =>
    createLotionHighlighter({
      themes: [...HIGHLIGHT_THEMES],
      langs: [],
    }),
});
