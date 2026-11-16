// 设计系统守卫（全仓）：尺寸/层级必须走 token，不许再写任意值。
//
// 背景（2026-11 token 收口）：色板一直是干净的（零硬编码颜色），但另一半从未 token 化，
// 于是长成了：211 处 text-[Npx]（14 个字号值）、13 种圆角（107 处任意值）、
// 64 处手写 0.5px、7 处 z-[99999]。这些都是"能编译、能跑，但改一次要摸 200 个文件"
// 的债务，所以在全局钉住，而不是靠下一个人记得。
//
// 与 test/components/ai/design-tokens.test.ts 的分工：那个只管 AI 面板的语义色；
// 这个管全仓的尺寸/圆角/发丝线/层级词法。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCAN_DIRS = ["src", "components", "hooks"];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir));
  return out;
}

/** 在全部源码里抓违规写法，返回 `文件 → 命中` 便于定位 */
function scan(pattern: RegExp): string[] {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    for (const hit of source.matchAll(pattern)) {
      offenders.push(`${path.relative(ROOT, file)} → ${hit[0]}`);
    }
  }
  return offenders;
}

function parseRgba(value: string): [number, number, number, number] {
  const match = /rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/.exec(value);
  if (!match) throw new Error(`无法解析 rgba: ${value}`);
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  ];
}

function relativeLuminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastOn(fg: [number, number, number, number], bg: readonly number[]): number {
  const composite = fg.slice(0, 3).map((channel, index) => channel * fg[3] + bg[index] * (1 - fg[3]));
  const [lighter, darker] = [relativeLuminance(composite), relativeLuminance(bg)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("全仓遵守设计 token 纪律", () => {
  it("不写字号任意值：用 --text-* 刻度（text-caption / ui-sm / ui / lead / body / title / display / hero）", () => {
    expect(
      scan(/text-\[\d+(?:\.\d+)?px\]/g),
      "字号应取 text-caption/ui-sm/ui/lead/body/title/display/hero，不要写 text-[13px]",
    ).toEqual([]);
  });

  it("不写圆角任意值：用 --radius-* 刻度（rounded-control / card / panel / sheet）", () => {
    expect(
      scan(/rounded-(?:[a-z]{1,2}-)?\[\d+(?:\.\d+)?px\]/g),
      "圆角应取 rounded-control(6)/card(10)/panel(14)/sheet(16)，不要写 rounded-[6px]",
    ).toEqual([]);
  });

  it("不写死 0.5px 发丝线：用 hairline / hairline-t / -b / -l / -r（含 1x 屏回退）", () => {
    expect(
      scan(/border(?:-[trbl])?-\[0\.5px\]/g),
      "分隔线应走 hairline 工具类：0.5px 在 1x 屏会被舍入成 0 或 1px，时有时无",
    ).toEqual([]);
  });

  it("不写 z-[99999] 逃生舱口：用 z-modal / z-popover（层级表在 globals.css）", () => {
    expect(
      scan(/z-\[9{4,}\]|zIndex:\s*9{4,}/g),
      "浮层层级应取 --z-modal(9980) / --z-popover(9990) / --z-toast(9999)",
    ).toEqual([]);
  });

  it("阴影只用 elevation 语义类（不写 shadow-[var(--shadow-sm)] / 裸 shadow-md）", () => {
    expect(
      scan(/shadow-\[\s*var\(--shadow-(?:sm|md|lg)\)\s*\]/g),
      "阴影应取 shadow-elevation-1/2/3（裸 shadow-md 走的是 Tailwind 默认值，不在设计系统里）",
    ).toEqual([]);
    expect(scan(/(?<![\w-])shadow-(?:sm|md|lg|xl)(?![\w-])/g), "阴影应取 shadow-elevation-1/2/3").toEqual(
      [],
    );
  });

  it("状态色走 warning/success/destructive 语义 token，不使用 Tailwind 裸色板", () => {
    expect(
      scan(/(?:text|bg|border|ring)-(?:amber|emerald|green|red|blue|slate|zinc|gray)-\d{2,3}/g),
      "状态色应取 text-warning / text-success / text-destructive 等语义 token",
    ).toEqual([]);
  });

  it("globals.css 真的定义了这些 token 与工具类（删了会让组件静默降级）", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/styles/globals.css"), "utf8");
    for (const token of [
      "--radius-control",
      "--radius-card",
      "--radius-panel",
      "--radius-sheet",
      "--text-caption",
      "--text-ui-sm",
      "--text-ui",
      "--text-lead",
      "--text-body",
      "--text-title",
      "--text-display",
      "--text-hero",
      "--text-editor-h1",
      "--text-editor-h3",
      "--text-editor-glyph",
      "--shell-label-placeholder",
      "--ds-transition-duration-fast",
      "--hairline",
      "--z-drawer",
      "--z-modal",
      "--z-popover",
      "--z-toast",
      "--shadow-elevation-1",
      "--shadow-elevation-2",
      "--shadow-elevation-3",
    ]) {
      expect(css, `globals.css 缺少 ${token}`).toContain(token);
    }
    // 1x 屏回退：没有这一条，非 Retina 上分隔线会丢
    expect(css, "缺少 max-resolution 的 1x 屏发丝线回退").toMatch(
      /@media\s*\(max-resolution:\s*1\.9dppx\)/,
    );
    // 自定义工具类必须存在，否则 hairline / z-modal 这些类名不会生成
    for (const utility of ["hairline", "hairline-b", "hairline-t", "hairline-l", "hairline-r", "z-drawer", "z-modal", "z-popover"]) {
      expect(css, `globals.css 缺少 @utility ${utility}`).toContain(`@utility ${utility}`);
    }
    expect(css, "触屏命中区工具类缺失").toContain(".touch-target");
    expect(css, "触屏命中区未按 pointer: coarse 扩展").toContain("@media (pointer: coarse)");
  });

  it("不再覆盖 Tailwind 的 --radius-sm/md/lg（覆盖过一次，导致 shadcn 派生组件圆角漂移）", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/styles/globals.css"), "utf8");
    for (const overridden of ["--radius-sm:", "--radius-md:", "--radius-lg:", "--radius-xl:", "--radius-2xl:"]) {
      expect(css, `不要覆盖 Tailwind 默认刻度 ${overridden}（用语义名 --radius-control 等）`).not.toContain(
        overridden,
      );
    }
  });

  it("BlockNote 纯 CSS 同样走发丝线、圆角与浮层层级 token", () => {
    const css = fs.readFileSync(path.join(ROOT, "components/editor/blocknote.css"), "utf8");
    expect(css, "BlockNote 样式不要手写 0.5px").not.toMatch(/\b0\.5px\b/);
    expect(css, "BlockNote 圆角应走 --radius-* token").not.toMatch(/border-radius:\s*\d+px/);
    expect(css, "BlockNote 浮层层级应走 --z-popover").not.toMatch(/z-index:\s*\d+/);
    expect(
      css,
      "BlockNote 字号应走 --text-* token；编辑器标题层级也不要在纯 CSS 里写裸 px",
    ).not.toMatch(/font-size:\s*\d+(?:\.\d+)?px/);
  });

  it("文档标题与正文共享响应式内容轨道", () => {
    const globals = fs.readFileSync(path.join(ROOT, "src/styles/globals.css"), "utf8");
    const blocknote = fs.readFileSync(path.join(ROOT, "components/editor/blocknote.css"), "utf8");
    expect(globals, "缺少响应式文档内容轨道").toContain(
      "--editor-inline: clamp(16px, 5cqi, 54px)",
    );
    expect(globals, "标题没有复用正文基线").toContain(
      ".document-title-rail",
    );
    expect(blocknote, "BlockNote 没有复用 --editor-inline").toContain(
      "padding-inline: var(--editor-inline, 54px)",
    );
  });

  it("placeholder 弱文本在明暗主题下都达到正文可读对比度", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/styles/globals.css"), "utf8");
    const values = [...css.matchAll(/--shell-label-placeholder:\s*([^;]+);/g)].map((hit) =>
      parseRgba(hit[1]),
    );
    expect(values).toHaveLength(2);
    expect(contrastOn(values[0], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    expect(contrastOn(values[1], [30, 30, 30])).toBeGreaterThanOrEqual(4.5);
  });

  it("插件卡片与营销顶栏在手机宽度采用紧凑布局", () => {
    const pluginSettings = fs.readFileSync(
      path.join(ROOT, "components/settings/plugin-settings.tsx"),
      "utf8",
    );
    const market = fs.readFileSync(
      path.join(ROOT, "components/settings/plugin-market.tsx"),
      "utf8",
    );
    const marketing = fs.readFileSync(path.join(ROOT, "src/marketing/navbar.tsx"), "utf8");
    expect(pluginSettings).toContain("flex-col gap-2");
    expect(pluginSettings).toContain("sm:flex-row");
    expect(market).toContain("sm:flex-col sm:items-end");
    expect(marketing).toContain("sm:hidden");
  });
});
