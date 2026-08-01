import { describe, expect, it } from "vitest";
import { markdownToBlocks, extractTitle } from "@/lib/markdown-to-blocks";

describe("markdownToBlocks", () => {
  it("空输入返回单个空段落", () => {
    expect(markdownToBlocks("")).toEqual([
      { id: "b-0", type: "paragraph", content: [] },
    ]);
    expect(markdownToBlocks("   ")).toEqual([
      { id: "b-0", type: "paragraph", content: [] },
    ]);
  });

  it("解析 # 标题为 heading level 1", () => {
    const blocks = markdownToBlocks("# Hello World");
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].props).toEqual({ level: 1 });
    expect(blocks[0].content[0].text).toBe("Hello World");
  });

  it("解析 ## 小节标题为 heading level 2（extractTitle 不提取）", () => {
    const blocks = markdownToBlocks("## 小节");
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].props).toEqual({ level: 2 });
    const { title } = extractTitle(blocks);
    expect(title).toBeNull();
  });

  it("解析 **加粗** 内联样式", () => {
    const blocks = markdownToBlocks("这是 **重点** 内容");
    const content = blocks[0].content;
    const bold = content.find((n) => n.text === "重点");
    expect(bold?.styles).toEqual({ bold: true });
  });

  it("解析 ***加粗斜体*** 组合样式", () => {
    const blocks = markdownToBlocks("***重要***");
    expect(blocks[0].content[0].styles).toEqual({ bold: true, italic: true });
  });

  it("解析 `代码` 内联样式", () => {
    const blocks = markdownToBlocks("运行 `pnpm dev` 启动");
    const code = blocks[0].content.find((n) => n.text === "pnpm dev");
    expect(code?.styles).toEqual({ code: true });
  });

  it("解析代码块 ```", () => {
    const blocks = markdownToBlocks("```ts\nconst a = 1;\n```");
    expect(blocks[0].type).toBe("codeBlock");
    expect(blocks[0].content[0].text).toBe("const a = 1;");
  });

  it("解析无序列表 - 和 *", () => {
    const ul = markdownToBlocks("- 第一项\n* 第二项");
    expect(ul).toHaveLength(2);
    expect(ul[0].type).toBe("bulletListItem");
    expect(ul[0].content[0].text).toBe("第一项");
    expect(ul[1].content[0].text).toBe("第二项");
  });

  it("解析有序列表 1. 2.", () => {
    const blocks = markdownToBlocks("1. 甲\n2. 乙");
    expect(blocks[0].type).toBe("numberedListItem");
    expect(blocks[1].content[0].text).toBe("乙");
  });

  it("解析引用 > 并附加斜体", () => {
    const blocks = markdownToBlocks("> 引用内容");
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].content[0].styles.italic).toBe(true);
  });

  it("深度嵌套标记不导致死循环/栈溢出（回归：MAX_INLINE_DEPTH 保险）", () => {
    // 历史 bug：模块级正则 lastIndex 共享导致无限循环，tool 执行超时
    const nested = "**a **b **c **d **e **f **g **h **i **j **k** j** i** h** g** f** e** d** c** b** a**";
    const blocks = markdownToBlocks(nested);
    expect(blocks).toHaveLength(1);
    // 输出应该是有限的文本节点
    const totalLen = blocks[0].content.reduce((sum, n) => sum + n.text.length, 0);
    expect(totalLen).toBeGreaterThan(0);
    expect(totalLen).toBeLessThan(200);
  });

  it("混合块类型按顺序解析", () => {
    const md = "# 标题\n\n第一段 **加粗**\n\n- 列表项";
    const blocks = markdownToBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bulletListItem",
    ]);
  });
});

describe("extractTitle", () => {
  it("提取开头一级标题并从正文移除", () => {
    const blocks = markdownToBlocks("# 文档标题\n\n正文内容");
    const { title, blocks: rest } = extractTitle(blocks);
    expect(title).toBe("文档标题");
    expect(rest).toHaveLength(1);
    expect(rest[0].content[0].text).toBe("正文内容");
  });

  it("非一级标题开头不提取", () => {
    const blocks = markdownToBlocks("## 小节\n正文");
    const { title, blocks: rest } = extractTitle(blocks);
    expect(title).toBeNull();
    expect(rest).toHaveLength(2);
  });

  it("普通段落开头不提取", () => {
    const blocks = markdownToBlocks("直接正文");
    const { title, blocks: rest } = extractTitle(blocks);
    expect(title).toBeNull();
    expect(rest).toHaveLength(1);
  });
});
