// 编辑器「块高亮」的静态守卫：底色必须给文字留呼吸，且不得改动布局。
//
// 背景（用户报障）：鼠标划过 / 进入编辑的段落，高亮底色会紧贴文字——截图里
// 「你好」距灰底左边缘约 1px，上下只有 3px。根因在 BlockNote 自带样式：
// `.bn-block-content { width: 100%; padding: 3px 0; display: flex }` —— 横向内边距是 0，
// 而这块底色（components/editor/blocknote.css 的 hover/focus-within 规则）就画在它上面。
//
// 修法选了 box-shadow spread 而不是「padding + 负 margin + width 补回」：
// 阴影不计入可滚动溢出，不会在窄屏上凭空多出一条横向滚动条，也不改换行宽度。
// 守卫见下方三条断言。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const CSS_PATH = path.join(ROOT, "components/editor/blocknote.css");
const CSS = fs.readFileSync(CSS_PATH, "utf8");

interface Rule {
  selector: string;
  body: string;
}

/** 去注释 → 按 `}` 切块 → 最后一个 `{` 之前是选择器（同 code-block-surface.test.ts） */
function parseRules(css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  for (const chunk of clean.split("}")) {
    const open = chunk.lastIndexOf("{");
    if (open === -1) continue;
    const selector = chunk.slice(0, open).trim();
    if (!selector || selector.startsWith("@")) continue;
    rules.push({ selector, body: chunk.slice(open + 1).trim() });
  }
  return rules;
}

/** 块高亮规则：hover/focus-within 的 .bn-block-content，底色是 --shell-row-hover */
const HIGHLIGHT_RULES = parseRules(CSS).filter(
  (rule) =>
    (rule.selector.includes(":hover") || rule.selector.includes(":focus-within")) &&
    rule.selector.includes(".bn-block-content") &&
    /background:\s*var\(--shell-row-hover\)/.test(rule.body),
);

describe("编辑器块高亮：底色给文字留呼吸", () => {
  it("检测器自身有效：找得到 hover 与 focus-within 那条规则", () => {
    expect(HIGHLIGHT_RULES.length, "找不到块高亮规则（改名后请同步本守卫）").toBeGreaterThan(0);
    expect(HIGHLIGHT_RULES.some((rule) => rule.selector.includes(":hover"))).toBe(true);
    expect(HIGHLIGHT_RULES.some((rule) => rule.selector.includes(":focus-within"))).toBe(true);
  });

  it("底色用 box-shadow spread 外扩 ≥ 4px（不再紧贴文字的一条灰条）", () => {
    for (const rule of HIGHLIGHT_RULES) {
      const shadow = /box-shadow\s*:\s*([^;]+)/.exec(rule.body)?.[1];
      expect(shadow, "块高亮缺少外扩阴影（文字会贴着底色边缘）").toBeDefined();
      // 形如 `0 0 0 6px var(--shell-row-hover)`：第 4 个值是 spread
      const spread = /0\s+0\s+0\s+(\d+(?:\.\d+)?)px/.exec(shadow ?? "")?.[1];
      expect(spread, "外扩阴影必须是 0 0 0 <spread>px 形式").toBeDefined();
      expect(Number.parseFloat(spread!)).toBeGreaterThanOrEqual(4);
      expect(shadow, "外扩色必须与底色同源 token").toContain("var(--shell-row-hover)");
    }
  });

  it("高亮规则不改布局（不写 padding/margin/width/height）", () => {
    for (const rule of HIGHLIGHT_RULES) {
      // 改成 padding + 负 margin 会改变换行宽度或产生横向滚动条，这里直接禁掉
      expect(rule.body, `块高亮不该声明布局属性：${rule.selector}`).not.toMatch(
        /(?:^|[;\s])(?:padding|margin|width|height|inline-size|block-size)\s*:/,
      );
    }
  });

  it("仍然排除自带底色的块（代码块 / Callout 的高亮不能被顶掉）", () => {
    for (const rule of HIGHLIGHT_RULES) {
      expect(rule.selector, "代码块必须继续排除").toContain(':not([data-content-type="codeBlock"])');
      expect(rule.selector, "Callout 必须继续排除").toContain(':not([data-content-type="callout"])');
    }
  });
});
