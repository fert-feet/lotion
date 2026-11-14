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
      "--hairline",
      "--z-modal",
      "--z-popover",
      "--z-toast",
    ]) {
      expect(css, `globals.css 缺少 ${token}`).toContain(token);
    }
    // 1x 屏回退：没有这一条，非 Retina 上分隔线会丢
    expect(css, "缺少 max-resolution 的 1x 屏发丝线回退").toMatch(
      /@media\s*\(max-resolution:\s*1\.9dppx\)/,
    );
    // 自定义工具类必须存在，否则 hairline / z-modal 这些类名不会生成
    for (const utility of ["hairline", "hairline-b", "hairline-t", "hairline-l", "hairline-r", "z-modal", "z-popover"]) {
      expect(css, `globals.css 缺少 @utility ${utility}`).toContain(`@utility ${utility}`);
    }
  });

  it("不再覆盖 Tailwind 的 --radius-sm/md/lg（覆盖过一次，导致 shadcn 派生组件圆角漂移）", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/styles/globals.css"), "utf8");
    for (const overridden of ["--radius-sm:", "--radius-md:", "--radius-lg:", "--radius-xl:", "--radius-2xl:"]) {
      expect(css, `不要覆盖 Tailwind 默认刻度 ${overridden}（用语义名 --radius-control 等）`).not.toContain(
        overridden,
      );
    }
  });
});
