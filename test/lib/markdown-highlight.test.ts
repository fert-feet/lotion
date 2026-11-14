// AI 正文代码块高亮的单测：真跑一次 shiki（precompiled 语言包，无外部服务）。
import { describe, it, expect, beforeEach } from "vitest";
import { highlightFence, resetHighlightCacheForTest } from "@/lib/markdown-highlight";

/** token 的可见文本拼回原文（渲染器会把 token 依次铺成行） */
function textOf(lines: { content: string }[][]): string {
  return lines.map((line) => line.map((token) => token.content).join("")).join("\n");
}

beforeEach(() => {
  resetHighlightCacheForTest();
});

describe("markdown 代码块高亮（highlightFence）", () => {
  it("TS 围栏被切成带双主题 CSS 变量的 token", async () => {
    const lines = await highlightFence("const a: number = 1;", "ts");
    expect(lines).not.toBeNull();
    // 行结构保留
    expect(lines!).toHaveLength(1);
    // 拼回原文必须与输入一致（渲染/复制都依赖这一点）
    expect(textOf(lines!)).toBe("const a: number = 1;");
    // 双主题：每个 token 只有 --shiki-light / --shiki-dark 变量，没有内联 color
    const styled = lines![0].filter((token) => token.htmlStyle !== undefined);
    expect(styled.length).toBeGreaterThan(0);
    for (const token of styled) {
      expect(token.htmlStyle!["--shiki-light"], "缺浅色主题色").toMatch(/^#/);
      expect(token.htmlStyle!["--shiki-dark"], "缺深色主题色").toMatch(/^#/);
      expect(token.htmlStyle!.color, "不能写内联 color（会让 .dark 规则失效）").toBeUndefined();
    }
  });

  it("多行代码保留空行（不能让行号错位）", async () => {
    const lines = await highlightFence("const a = 1;\n\nconst b = 2;", "typescript");
    expect(lines).toHaveLength(3);
    expect(lines![1]).toEqual([]);
    expect(textOf(lines!)).toBe("const a = 1;\n\nconst b = 2;");
  });

  it("不认识的语言 / 空代码 / 纯文本标识返回 null（调用方退回纯文本）", async () => {
    expect(await highlightFence("x = 1", "dockerfile")).toBeNull();
    expect(await highlightFence("", "ts")).toBeNull();
    expect(await highlightFence("hello", "text")).toBeNull();
    expect(await highlightFence("hello", undefined)).toBeNull();
  });

  it("超长代码直接放弃高亮（不与 shiki 的内部超时赛跑）", async () => {
    expect(await highlightFence("a".repeat(20_001), "ts")).toBeNull();
  });

  it("同样的代码重复请求命中缓存（同一数组引用）", async () => {
    const first = await highlightFence("let x = 1;", "ts");
    const second = await highlightFence("let x = 1;", "ts");
    expect(second).toBe(first);
    // 语言不同 → 不同缓存键
    expect(await highlightFence("let x = 1;", "js")).not.toBe(first);
  });
});
