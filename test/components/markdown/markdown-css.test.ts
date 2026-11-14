// AI 正文样式的静态守卫（markdown.css）。
//
// 背景（2026-11）：design-system.test.ts 只扫 .ts/.tsx，而 markdown.css 是纯 .css，
// 于是它整份脱离了 globals.css 的刻度表且没人报错——正文 14px（阶梯里没有 14）、
// h1 26px（比 app 的 text-title 22 还大）、圆角 4/6/8px、动效 0.15s ease 硬编码。
// 同时还藏着两处功能性缺陷：
//   ① render.tsx 输出 .contains-task-list / .task-list-item，CSS 里一条规则都没有
//      → `- [ ] 待办` 同时出现「默认圆点 + 复选框」两个标记；
//   ② 代码块没有 max-height → 模型贴 300 行代码会把整条对话顶出视口；
//     复制按钮命中区约 18px 且没有 :focus-visible（键盘可达性）。
// 这里用读 CSS 源码做规则断言的方式钉住（与 code-block-surface.test.ts 同款做法）。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const CSS_PATH = path.join(ROOT, "components/markdown/markdown.css");
const TURN_PATH = path.join(ROOT, "src/shell/ai/turn.tsx");
const CSS = fs.readFileSync(CSS_PATH, "utf8");

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

const RULES = parseRules(CSS);

/** 某条选择器（精确匹配）的声明体；缺省返回 null */
function bodyOf(selector: string): string | null {
  return RULES.find((rule) => rule.selector === selector)?.body ?? null;
}

/** 收集某属性在全部规则里的取值 */
function declarations(property: string): Array<{ selector: string; value: string }> {
  const pattern = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`, "g");
  const out: Array<{ selector: string; value: string }> = [];
  for (const rule of RULES) {
    for (const hit of rule.body.matchAll(pattern)) {
      out.push({ selector: rule.selector, value: hit[1].trim() });
    }
  }
  return out;
}

/** 字号取值是否合法：刻度 token（--text-*）、继承、或相对 em */
function isScaleFontSize(value: string): boolean {
  return (
    /^var\(--text-[a-z-]+\)$/.test(value) ||
    value === "inherit" ||
    /^0?\.\d+em$/.test(value) ||
    /^\d+em$/.test(value)
  );
}

/** 圆角取值是否合法：刻度 token（--radius-*）、0、或行内相对 em */
function isScaleRadius(value: string): boolean {
  return (
    /^var\(--radius-[a-z]+\)$/.test(value) || value === "0" || /^0?\.\d+em$/.test(value)
  );
}

describe("AI 正文样式遵守设计 token", () => {
  it("检测器自身有效：抓得到阶梯外字号/圆角，也不误伤 token 与相对单位", () => {
    expect(isScaleFontSize("14px"), "阶梯外的 px 字号应当被拦下").toBe(false);
    expect(isScaleFontSize("var(--text-lead)")).toBe(true);
    expect(isScaleFontSize("0.9em")).toBe(true);
    expect(isScaleFontSize("inherit")).toBe(true);

    expect(isScaleRadius("8px"), "阶梯外的 px 圆角应当被拦下").toBe(false);
    expect(isScaleRadius("var(--radius-card)")).toBe(true);
    expect(isScaleRadius("0.25em")).toBe(true);
  });

  it("字号只取 --text-* 刻度（正文 = --text-lead 15px，阶梯里没有 14px）", () => {
    const offenders = declarations("font-size")
      .filter((item) => !isScaleFontSize(item.value))
      .map((item) => `${item.selector} → ${item.value}`);
    expect(offenders, "字号应取 text-caption/ui-sm/ui/lead/body/title/display/hero 刻度").toEqual([]);
    expect(bodyOf(".md-content"), "AI 正文基准字号应取 --text-lead（不再是裸 14px）").toContain(
      "font-size: var(--text-lead)",
    );
  });

  it("圆角只取 --radius-* 刻度（6/10/14/16）", () => {
    const offenders = declarations("border-radius")
      .filter((item) => !isScaleRadius(item.value))
      .map((item) => `${item.selector} → ${item.value}`);
    expect(offenders, "圆角应取 --radius-control/card/panel/sheet").toEqual([]);
  });

  it("动效走 --ds-ease-out + --ds-transition-duration-slow（不再硬编码 0.15s ease）", () => {
    const offenders = declarations("transition")
      .filter((item) => !item.value.includes("var(--ds-ease-"))
      .map((item) => `${item.selector} → ${item.value}`);
    expect(offenders, "transition 必须引用 --ds-ease-* 曲线").toEqual([]);
    expect(
      declarations("transition").every((item) => item.value.includes("var(--ds-transition-duration-slow)")),
      "transition 必须引用 --ds-transition-duration-slow 时长",
    ).toBe(true);
  });

  it("不写死颜色：一律 --shell-* / --radius 等语义 token（无色值、无透明边 hack）", () => {
    expect(CSS, "markdown.css 不该出现十六进制色值").not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS, "不该出现 rgb()/hsl() 裸色值（含 rgb(255 255 255 / 0) 透明边 hack）").not.toMatch(
      /\b(?:rgba?|hsla?)\(/,
    );
  });

  it("不靠 !important 兜底（首尾外边距用 :is() 特异性解决）", () => {
    expect(CSS).not.toContain("!important");
  });

  it("任务列表必须有落点：.task-list-item 去标记，.contains-task-list 收紧缩进", () => {
    expect(bodyOf(".md-content .task-list-item"), "缺 .task-list-item 规则 → 圆点与复选框会同时出现").toContain(
      "list-style: none",
    );
    expect(bodyOf(".md-content .contains-task-list"), "缺 .contains-task-list 缩进规则").not.toBeNull();
  });

  it("长代码块自带滚动（max-height），不把整条对话顶出视口", () => {
    expect(bodyOf(".md-code-block pre"), "代码块 pre 缺少 max-height").toMatch(/max-height\s*:/);
  });

  it("复制按钮键盘可达：命中区 ≥ 22px 且有 :focus-visible", () => {
    expect(bodyOf(".md-code-copy"), "复制按钮应有最小高度").toMatch(/min-height\s*:\s*2[2-9]px/);
    expect(bodyOf(".md-code-copy:focus-visible"), "复制按钮缺 :focus-visible 焦点环").not.toBeNull();
  });

  it("链接默认带下划线（不靠颜色单独区分，WCAG 1.4.1）", () => {
    expect(bodyOf(".md-content a")).toContain("text-decoration: underline");
  });

  it("表格末行去掉下边框（避免与下文叠出双线）", () => {
    expect(
      bodyOf(".md-table-scroll tbody tr:last-child > td"),
      "缺末行去线规则 → 表格底部与正文之间会出现两条相邻细线",
    ).toContain("border-bottom: none");
  });

  it("正文排版只有一处真相源：turn.tsx 不再给 MarkdownText 外层重复声明字号", () => {
    const turn = fs.readFileSync(TURN_PATH, "utf8");
    expect(
      turn,
      "MarkdownText 外层不要写 text-lead / leading-[1.6]（字号由 .md-content 决定）",
    ).not.toMatch(/text-lead[^"]*"\s*>\s*<MarkdownText/);
  });
});
