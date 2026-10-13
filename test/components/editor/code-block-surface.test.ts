// 编辑器样式的静态守卫：**自带底色的块不能被行 hover / focus 底色顶掉**。
//
// 背景（2026-09-29 用户报障「markdown 代码框编辑的时候会变亮色，普通状态又是暗色」）：
// 代码块的深色代码面 #161616 由 BlockNote 自带样式提供
// （`.bn-block-content[data-content-type=codeBlock]{background-color:#161616}`，特异性 (0,2,0)）。
// 而 components/editor/blocknote.css 的「块 hover / 选中：浅色圆角高亮」规则是
// `.bn-block-outer:focus-within > .bn-block > .bn-block-content`（特异性 (0,8,0)），
// 且用的是 `background` **简写** —— 简写会整体替换 background-color，于是：
//   ① 点进代码块编辑（:focus-within）或鼠标划过（:hover）；
//   ② #161616 被换成 rgba(0,0,0,.045)（--shell-row-hover 亮色档）；
//   ③ 透明黑透出页面白底 → 代码块变成浅灰，而 shiki 令牌色仍是 github-dark 那套。
// 表现就是"编辑时变亮、静止时又变暗"。
//
// 保住的契约：带自有底色的块（codeBlock / callout）只由自己的规则决定背景，
// 行高亮不得覆盖它们。检查方式是读 CSS 源码做选择器断言（同 test/components/ai/design-tokens.test.ts）。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const CSS_PATH = path.join(ROOT, "components/editor/blocknote.css");

interface Rule {
  selector: string;
  body: string;
}

/** 去注释 → 按 `}` 切块 → 最后一个 `{` 之前是选择器（不做嵌套 at-rule 的完整解析） */
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

/** 去掉 `:not(...)` 再判断，否则「排除代码块」的写法会被误判成「命中代码块」 */
function withoutNot(selector: string): string {
  return selector.replace(/:not\([^)]*\)/g, "");
}

const CODE_BLOCK_ATTR = /\[data-content-type=["']?codeBlock["']?\]/;

/** 规则是否落在代码块**容器**上（容器承载 #161616；`> pre` / `> code` 是子元素，不算） */
function targetsCodeBlockContainer(selector: string): boolean {
  const bare = withoutNot(selector);
  return CODE_BLOCK_ATTR.test(bare) && !/>\s*(pre|code)\b/.test(bare);
}

function setsBackground(body: string): boolean {
  return /\bbackground(-color)?\s*:/.test(body);
}

/** 违反项一：项目 CSS 直接给代码块容器设背景（会顶掉深色代码面） */
function codeBlockSurfaceClobbers(css: string): string[] {
  return parseRules(css)
    .filter((rule) => targetsCodeBlockContainer(rule.selector) && setsBackground(rule.body))
    .map((rule) => rule.selector);
}

/** 违反项二：块 hover / focus 高亮规则没有排除自带底色的块 */
const CARVE_OUT = /:not\(\[data-content-type=["']?(?:codeBlock|callout)["']?\]\)/;

function hoverHighlightRules(css: string): Rule[] {
  return parseRules(css).filter(
    (rule) =>
      (rule.selector.includes(":hover") || rule.selector.includes(":focus-within")) &&
      rule.selector.includes(".bn-block-content") &&
      setsBackground(rule.body),
  );
}

describe("编辑器：自带底色的块不被行高亮覆盖", () => {
  it("检测器自身有效：认得出该拦的、也不误伤已排除的写法", () => {
    const bad = `.lotion-editor .bn-editor .bn-block-content[data-content-type="codeBlock"] { background: var(--shell-row-hover); }`;
    expect(codeBlockSurfaceClobbers(bad), "给代码块容器设背景应当被拦下").toHaveLength(1);

    const good = `.lotion-editor .bn-editor .bn-block-content:not([data-content-type="codeBlock"]) { background: var(--shell-row-hover); }`;
    expect(codeBlockSurfaceClobbers(good), "已用 :not() 排除的写法不该被误判").toEqual([]);

    // 代码块**子元素**（> pre）的背景规则不算犯规：它是代码面自己的内边距/字体层
    const child = `.lotion-editor .bn-editor .bn-block-content[data-content-type="codeBlock"] > pre { background: red; }`;
    expect(codeBlockSurfaceClobbers(child)).toEqual([]);

    const hoverCss = `.lotion-editor .bn-editor .bn-block-outer:hover > .bn-block > .bn-block-content { background: var(--shell-row-hover); }`;
    const [hoverRule] = hoverHighlightRules(hoverCss);
    expect(hoverRule, "行高亮规则应当被识别出来").toBeDefined();
    expect(hoverRule.selector, "取到的应当是规则的选择器").toContain(".bn-block-content");
    expect(CARVE_OUT.test(hoverRule.selector), "未排除代码块的行高亮应判定为缺 carve-out").toBe(false);
  });

  it("项目 CSS 不给代码块容器设背景（深色代码面归 BlockNote）", () => {
    const offenders = codeBlockSurfaceClobbers(fs.readFileSync(CSS_PATH, "utf8"));
    expect(
      offenders,
      "项目 CSS 给代码块容器设了 background：`background` 简写会整体替换 BlockNote 的 #161616 深色代码面",
    ).toEqual([]);
  });

  it("行 hover / focus 高亮排除代码块与 Callout（否则编辑时透出白底变亮）", () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    const rules = hoverHighlightRules(css);

    // 非空转：这条 Notion 语义的行高亮必须还在（别用"删掉规则"来通过本用例）
    expect(rules.length, "行 hover / focus 高亮规则不见了？它是 Notion 语义的一部分").toBeGreaterThan(0);
    expect(
      rules.some((rule) => rule.body.includes("--shell-row-hover")),
      "行高亮仍应用 --shell-row-hover 底色",
    ).toBe(true);

    const missing = rules
      .filter((rule) => !CARVE_OUT.test(rule.selector))
      .map((rule) => rule.selector);
    expect(
      missing,
      "行高亮规则缺 :not([data-content-type=...])：代码块编辑时 #161616 会被换成半透明黑 → 透出页面白底",
    ).toEqual([]);
  });
});
