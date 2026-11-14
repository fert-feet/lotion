// AI 正文代码块的语法高亮（渲染器侧）。
//
// 与编辑器侧（lib/code-highlight.ts）共用同一份语言表与主题，但**不共用打包边界**：
//   · 编辑器侧由 BlockNote 扩展在路由 chunk 里同步引入；
//   · 这里用动态 import 懒加载 shiki（首屏/无代码块的对话零成本）。
//
// 为什么返回 token 而不是 shiki 的 HTML 字符串：render.tsx 对「不可信 assistant 输出」
// 的整条策略是不把任何字符串塞进 dangerouslySetInnerHTML。token 渲染成 React
// <span style>，既保住了这条策略，也天然得到双主题（light/dark 各一套 CSS 变量）。
import type { ThemedToken } from "@shikijs/core";
import { normalizeFenceLang } from "./highlight-langs";

/** 高亮结果：逐行、逐 token（空行是空数组）。 */
export type HighlightedLines = ThemedToken[][];

type Highlighter = Awaited<ReturnType<typeof import("./highlight-shared").createLotionHighlighter>>;

/** 缓存上限：对话里重复的代码块（重渲染 / 历史回放）不必重新 tokenize。 */
const CACHE_LIMIT = 80;
/** 超过这个长度直接放弃高亮：shiki 有内部超时，不如我们先退化为纯文本。 */
const MAX_HIGHLIGHT_LENGTH = 20_000;

let highlighterPromise: Promise<Highlighter> | null = null;
const cache = new Map<string, HighlightedLines>();

/** 懒创建单例高亮器（含两个主题；语言在用到时才按需加载）。 */
function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= (async () => {
    const { createLotionHighlighter, HIGHLIGHT_THEMES } = await import("./highlight-shared");
    return createLotionHighlighter({ themes: [...HIGHLIGHT_THEMES], langs: [] });
  })();
  return highlighterPromise;
}

/**
 * 把一段围栏代码高亮为 token。
 * @param code - 代码正文（已裁剪末尾换行）。
 * @param lang - 围栏语言标识（原样传入，内部做别名归一）。
 * @returns 逐行 token；语言不认识 / 空代码 / 超长 / 语法加载失败时返回 `null`（调用方退回纯文本）。
 */
export async function highlightFence(
  code: string,
  lang: string | undefined,
): Promise<HighlightedLines | null> {
  const canonical = normalizeFenceLang(lang);
  if (canonical === null || code === "" || code.length > MAX_HIGHLIGHT_LENGTH) return null;

  const key = `${canonical}\u0000${code}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  try {
    const highlighter = await getHighlighter();
    await highlighter.loadLanguage(canonical);
    const { tokens } = highlighter.codeToTokens(code, {
      lang: canonical,
      themes: { light: "github-light", dark: "github-dark" },
      // 只写 CSS 变量、不写内联 color：明暗切换交给 .dark 规则，
      // 否则内联 color 会赢过样式表，切换主题时高亮色不跟着变。
      defaultColor: false,
    });
    cache.set(key, tokens);
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return tokens;
  } catch {
    // 语法包加载失败（离线 / chunk 404）：静默退化为纯文本，不能打断消息渲染
    return null;
  }
}

/** 仅供测试：清空缓存与单例，避免用例之间互相污染。 */
export function resetHighlightCacheForTest(): void {
  cache.clear();
  highlighterPromise = null;
}
