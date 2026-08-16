// 自研 BlockNote JSON → Markdown 转换器单测（服务端读旧数据用，
// 不依赖 BlockNote 运行时）。覆盖常用块类型与 inline 样式。
import { describe, expect, it } from "vitest";
import { blocksToMarkdown } from "@/lib/blocks-to-markdown";

describe("blocksToMarkdown", () => {
  it("heading 按 props.level 输出 # 前缀，段落原样", () => {
    const md = blocksToMarkdown([
      { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "大标题", styles: {} }] },
      { type: "heading", props: { level: 3 }, content: [{ type: "text", text: "小节", styles: {} }] },
      { type: "paragraph", content: [{ type: "text", text: "正文", styles: {} }] },
    ]);
    expect(md).toBe("# 大标题\n\n### 小节\n\n正文");
  });

  it("inline 样式：加粗/斜体/删除线/代码/链接", () => {
    const md = blocksToMarkdown([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "重点", styles: { bold: true } },
          { type: "text", text: "斜体", styles: { italic: true } },
          { type: "text", text: "删", styles: { strike: true } },
          { type: "text", text: " `码` " },
          { type: "link", href: "https://x.com", content: [{ type: "text", text: "链接", styles: {} }] },
        ],
      },
    ]);
    expect(md).toContain("**重点**");
    expect(md).toContain("*斜体*");
    expect(md).toContain("~~删~~");
    expect(md).toContain("[链接](https://x.com)");
  });

  it("列表：bullet / numbered / todo（含勾选状态）", () => {
    const md = blocksToMarkdown([
      { type: "bulletListItem", content: [{ type: "text", text: "甲", styles: {} }] },
      { type: "numberedListItem", content: [{ type: "text", text: "乙", styles: {} }] },
      { type: "todoListItem", props: { checked: true }, content: [{ type: "text", text: "完成", styles: {} }] },
      { type: "todoListItem", props: { checked: false }, content: [{ type: "text", text: "待办", styles: {} }] },
    ]);
    expect(md).toContain("- 甲");
    expect(md).toContain("1. 乙");
    expect(md).toContain("- [x] 完成");
    expect(md).toContain("- [ ] 待办");
  });

  it("嵌套列表缩进两级", () => {
    const md = blocksToMarkdown([
      {
        type: "bulletListItem",
        content: [{ type: "text", text: "父项", styles: {} }],
        children: [{ type: "bulletListItem", content: [{ type: "text", text: "子项", styles: {} }] }],
      },
    ]);
    expect(md).toBe("- 父项\n  - 子项");
  });

  it("代码块带语言围栏", () => {
    const md = blocksToMarkdown([
      {
        type: "codeBlock",
        props: { language: "ts" },
        content: [{ type: "text", text: "const a = 1;", styles: {} }],
      },
    ]);
    expect(md).toBe("```ts\nconst a = 1;\n```");
  });

  it("引用块每行加 > 前缀；分隔线输出 ---", () => {
    const md = blocksToMarkdown([
      { type: "quote", content: [{ type: "text", text: "引用第一行\n引用第二行", styles: {} }] },
      { type: "divider" },
    ]);
    expect(md).toContain("> 引用第一行\n> 引用第二行");
    expect(md).toContain("---");
  });

  it("块间空行分隔；空块跳过；未知类型降级为段落文本", () => {
    const md = blocksToMarkdown([
      { type: "paragraph", content: [{ type: "text", text: "一", styles: {} }] },
      { type: "paragraph", content: [] },
      { type: "someFutureBlock", content: [{ type: "text", text: "降级文本", styles: {} }] },
    ]);
    expect(md).toBe("一\n\n降级文本");
  });

  it("空数组返回空串", () => {
    expect(blocksToMarkdown([])).toBe("");
  });
});
