// 块锚点工具单测：提取 / 全文剥离（跳过代码围栏）/ 渲染克隆剥离。
import { describe, expect, it } from "vitest";
import { parseGfm } from "@/components/markdown/parse";
import {
  cloneRootWithoutAnchors,
  extractAnchor,
  stripAnchorFromLine,
  stripAnchorsFromMarkdown,
} from "@/lib/editor/anchors";

describe("extractAnchor", () => {
  it("行尾 {#id} 提取锚点并剥离文本", () => {
    expect(extractAnchor("正文内容 {#intro}")).toEqual({ id: "intro", text: "正文内容" });
    expect(extractAnchor("正文 {#sec-1}")).toEqual({ id: "sec-1", text: "正文" });
  });

  it("中文锚点 / 无锚点 / 锚点前后空格", () => {
    expect(extractAnchor("标题 {#第一章}")).toEqual({ id: "第一章", text: "标题" });
    expect(extractAnchor("普通文本")).toEqual({ id: null, text: "普通文本" });
    expect(extractAnchor("文本  {#x}  ")).toEqual({ id: "x", text: "文本" });
  });

  it("行中 {#id}（非行尾）不算锚点", () => {
    expect(extractAnchor("{#x} 在行中")).toEqual({ id: null, text: "{#x} 在行中" });
  });
});

describe("stripAnchorsFromMarkdown", () => {
  it("全文剥离行尾锚点（段落/标题/列表/引用）", () => {
    const md = "# 标题 {#h1}\n\n正文 {#p1}\n\n- 列表项 {#li1}\n\n> 引用 {#q1}";
    const stripped = stripAnchorsFromMarkdown(md);
    expect(stripped).not.toContain("{#");
    expect(stripped).toContain("# 标题");
    expect(stripped).toContain("> 引用");
  });

  it("代码块围栏内的 {#id} 不剥离（是代码不是锚点）", () => {
    const md = "```ts\nconst x = \"{#code}\";\n```\n\n正文 {#p1}";
    const stripped = stripAnchorsFromMarkdown(md);
    expect(stripped).toContain('"{#code}"');
    expect(stripped).not.toContain("{#p1}");
  });

  it("行内代码里的 {#id} 会剥离（可接受简化：锚点标记为行尾约定）", () => {
    expect(stripAnchorsFromMarkdown("使用 `{#x}` 语法 {#real}")).toBe("使用 `{#x}` 语法");
  });
});

describe("stripAnchorFromLine / cloneRootWithoutAnchors", () => {
  it("克隆树剥离锚点，position/结构保留", () => {
    const root = parseGfm("标题 {#t1}\n\n正文 {#p1}");
    const clone = cloneRootWithoutAnchors(root);
    const texts = (node: unknown): string[] => {
      const n = node as { type?: string; value?: string; children?: unknown[] };
      const out: string[] = [];
      if (n.type === "text") out.push(n.value ?? "");
      for (const c of n.children ?? []) out.push(...texts(c));
      return out;
    };
    const values = texts(clone);
    expect(values).toContain("标题");
    expect(values).toContain("正文");
    expect(values.some((v) => v.includes("{#"))).toBe(false);
    // 结构保留（position 存在）
    expect(clone.children[0].position).toBeDefined();
    // 原树不受影响
    expect(stripAnchorFromLine("x {#a}")).toBe("x");
  });
});
