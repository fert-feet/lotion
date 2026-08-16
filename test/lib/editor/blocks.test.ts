// 自研块编辑器内核：块模型解析单测（parseEditableBlocks）。
import { describe, expect, it } from "vitest";
import { parseEditableBlocks } from "@/lib/editor/blocks";

describe("parseEditableBlocks", () => {
  it("段落/标题/分隔线/引用/代码块映射为对应 kind，源切片与原文一致", () => {
    const md = "# 大标题\n\n正文段落\n\n> 引用\n\n```ts\nconst a = 1;\n```\n\n---\n";
    const blocks = parseEditableBlocks(md);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "quote", "code", "divider"]);

    const heading = blocks[0];
    expect(heading.meta.level).toBe(1);
    expect(heading.text).toBe("大标题");
    expect(md.slice(heading.start, heading.end)).toBe("# 大标题");

    expect(blocks[1].text).toBe("正文段落");
    expect(blocks[2].text).toBe("引用");
    expect(blocks[3].meta.lang).toBe("ts");
    expect(blocks[3].text).toBe("const a = 1;");
  });

  it("列表内每个 listItem 独立成块（bullet/numbered/todo），嵌套子列表归属 item 源切片", () => {
    const md = "- 父项\n  - 子项\n- 第二项\n\n1. 甲\n2. 乙\n\n- [x] 完成\n- [ ] 待办";
    const blocks = parseEditableBlocks(md);

    expect(blocks.map((b) => b.kind)).toEqual([
      "bullet", "bullet", "numbered", "numbered", "todo", "todo",
    ]);
    expect(blocks.map((b) => b.text)).toEqual([
      "父项", "第二项", "甲", "乙", "完成", "待办",
    ]);
    // 嵌套子列表包含在父项源切片内（编辑父项文本时整体保留）
    expect(blocks[0].source).toBe("- 父项\n  - 子项");
    // todo 勾选状态
    expect(blocks[4].meta.checked).toBe(true);
    expect(blocks[5].meta.checked).toBe(false);
  });

  it("表格映射为 table 块（只读）", () => {
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const blocks = parseEditableBlocks(md);
    expect(blocks.map((b) => b.kind)).toEqual(["table"]);
    expect(md.slice(blocks[0].start, blocks[0].end)).toBe(md.trimEnd());
  });

  it("空文档保底一个空段落块", () => {
    const blocks = parseEditableBlocks("");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("paragraph");
    expect(blocks[0].text).toBe("");
  });

  it("块索引按序分配；start 偏移严格递增", () => {
    const md = "第一段\n\n第二段\n\n第三段";
    const blocks = parseEditableBlocks(md);
    expect(blocks.map((b) => b.index)).toEqual([0, 1, 2]);
    expect(blocks[0].start < blocks[1].start).toBe(true);
    expect(blocks[1].start < blocks[2].start).toBe(true);
  });
});

describe("parseEditableBlocks 块锚点", () => {
  it("段落/标题/列表项行尾 {#id} 提取为 meta.anchor，text 剥离", () => {
    const md = "标题 {#t1}\n\n正文 {#p1}\n\n- 列表项 {#li1}";
    const blocks = parseEditableBlocks(md);
    expect(blocks.map((b) => b.meta.anchor)).toEqual(["t1", "p1", "li1"]);
    expect(blocks.map((b) => b.text)).toEqual(["标题", "正文", "列表项"]);
  });

  it("代码块锚点取内容最后一行（围栏内代码不受影响）", () => {
    const md = "```ts\nconst a = 1;\n// 说明 {#code1}\n```";
    const blocks = parseEditableBlocks(md);
    expect(blocks[0].meta.anchor).toBe("code1");
    expect(blocks[0].text).toBe("const a = 1;\n// 说明");
  });

  it("无锚点块 meta.anchor 为 undefined", () => {
    const blocks = parseEditableBlocks("普通段落");
    expect(blocks[0].meta.anchor).toBeUndefined();
  });
});
