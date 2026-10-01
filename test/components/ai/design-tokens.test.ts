// 设计系统守卫：AI 面板必须遵守 token 纪律（静态检查，tsc 抓不到这类问题）。
//
// 背景（2026-09 UI 重构）：AI 面板此前**整体绕过了设计系统** ——
//   * 13 处写死颜色，其中有 Tailwind 默认的 amber-500（根本不在 macOS 系统色板里）；
//   * 11 种混用圆角（rounded-[18px] / [14px] / [10px] / [7px] / [5px] / lg / md / xl …）；
//   * 用户气泡用了 AI 品牌黄（bg-ai-muted），而 AI 品牌黄本该属于助手，语义是反的。
// 这些都是"能编译、能跑、但视觉语言崩了"的问题，所以在这里钉住，
// 而不是指望下一个人记得。检查方式是读源码做正则（与 test/layout/height-chain.test.tsx 同款做法）。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const AI_DIR = path.join(ROOT, "src/shell/ai");

/** AI 面板的全部源文件：面板本体 + ai/ 子目录（卡片、回合、菜单、AI 标识） */
function aiPanelFiles(): string[] {
  const sub = fs
    .readdirSync(AI_DIR)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => path.join(AI_DIR, name));
  return [path.join(ROOT, "src/shell/ai-panel.tsx"), ...sub];
}

/** Tailwind 内置命名色板（这些颜色由框架提供，不是我们的语义 token） */
const NAMED_PALETTE =
  "amber|blue|gray|zinc|slate|green|red|yellow|orange|stone|neutral|teal|cyan|indigo|violet|purple|fuchsia|pink|rose|lime|emerald|sky";

/** 找出源码里所有写死的颜色工具类（命名色板 + white/black） */
function hardcodedColors(source: string): string[] {
  const pattern = new RegExp(
    `\\b(?:text|bg|border|ring|divide|from|to|via|fill|stroke)-(?:${NAMED_PALETTE})-\\d{2,3}\\b|\\b(?:text|bg|border|divide|fill|stroke)-(?:white|black)\\b`,
    "g",
  );
  return [...source.matchAll(pattern)].map((match) => match[0]);
}

describe("AI 面板遵守设计系统", () => {
  it("检测器自身有效：抓得到写死颜色，且不误伤语义 token", () => {
    expect(hardcodedColors('className="text-amber-500 bg-white"')).toEqual([
      "text-amber-500",
      "bg-white",
    ]);
    // 语义 token / 任意值 / 非颜色工具类都不该被命中
    expect(
      hardcodedColors(
        'className="text-shell-label-secondary bg-primary text-primary-foreground border-shell-border-l2 text-[11px] bg-destructive/10 text-warning"',
      ),
    ).toEqual([]);
  });

  it("不写死颜色：一律走语义 token（禁用 Tailwind 命名色板与 white/black）", () => {
    const offenders: string[] = [];
    for (const file of aiPanelFiles()) {
      for (const hit of hardcodedColors(fs.readFileSync(file, "utf8"))) {
        offenders.push(`${path.relative(ROOT, file)} → ${hit}`);
      }
    }
    expect(
      offenders,
      "组件里写死颜色（AGENTS.md：组件里不写死颜色，一律用语义 token，如 text-shell-label-secondary / bg-primary）",
    ).toEqual([]);
  });

  it("圆角只用 token 档位（不出现 rounded-[Npx] 任意值）", () => {
    const offenders: string[] = [];
    for (const file of aiPanelFiles()) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/rounded-\[\d+px\]/g)) {
        offenders.push(`${path.relative(ROOT, file)} → ${match[0]}`);
      }
    }
    expect(
      offenders,
      "圆角应取 token：--radius-xs/sm/md/lg/xl/2xl（4/6/8/10/14/20px），对应 rounded-xs/sm/md/lg/xl/2xl",
    ).toEqual([]);
  });

  it("用户气泡用 systemBlue（primary），不用 AI 品牌色 —— 否则说话人语义是反的", () => {
    const turn = fs.readFileSync(path.join(AI_DIR, "turn.tsx"), "utf8");
    expect(turn, "用户气泡应当是 primary 实底 + primary-foreground 文字").toMatch(
      /rounded-2xl bg-primary[^"]*text-primary-foreground/,
    );
    expect(turn, "用户气泡不该再用 bg-ai-muted（AI 品牌黄属于助手身份，不属于用户）").not.toContain(
      "bg-ai-muted",
    );
    // 闭环：胶囊的反色变体必须真的被用上，否则蓝气泡里的 @提及 是蓝底蓝字（隐形）
    expect(turn, "用户气泡里的 @提及 必须走反色胶囊（onAccent=true）").toMatch(
      /renderMentions\(turn\.userContent, onOpenDocument, true\)/,
    );
  });

  it("globals.css 提供组件依赖的 token 与工具类（删了会让面板静默掉色）", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/styles/globals.css"), "utf8");

    // AI 身份 = Apple Intelligence 多色渐变（四个色标 + .ai-orb 本体）
    for (const token of ["--ai-grad-1", "--ai-grad-2", "--ai-grad-3", "--ai-grad-4"]) {
      expect(css, `globals.css 缺少 ${token}（AI 身份渐变色标）`).toContain(token);
    }
    expect(css, "globals.css 缺少 .ai-orb（AI 身份标识本体）").toMatch(/\.ai-orb\s*\{/);

    // 状态语义色：替换掉组件里写死的 Tailwind amber
    for (const token of ["--warning", "--success"]) {
      expect(css, `globals.css 缺少 ${token}（状态语义色）`).toContain(token);
    }

    // 蓝气泡里的提及胶囊必须反色：否则 .mention-chip 的"蓝底蓝字"落在蓝气泡上等于隐形
    expect(css, "缺少 .mention-chip-on-accent（用户气泡内的 @提及 会隐形）").toMatch(
      /\.mention-chip-on-accent\s*\{/,
    );
  });
});
