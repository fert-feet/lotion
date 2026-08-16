// 自研块编辑器内核：编辑操作单测（纯函数，markdown → markdown）。
import { describe, expect, it } from "vitest";
import {
  deleteBlock,
  mergeIntoPrevious,
  replaceBlockText,
  splitBlock,
  toggleTodo,
} from "@/lib/editor/ops";
import { parseEditableBlocks } from "@/lib/editor/blocks";

describe("replaceBlockText", () => {
  it("替换段落文本，其余原文不动", () => {
    const md = "第一段\n\n第二段\n\n第三段";
    const { markdown } = replaceBlockText(md, 1, "改写第二段");
    expect(markdown).toBe("第一段\n\n改写第二段\n\n第三段");
  });

  it("heading 保留级别前缀；bullet/numbered/todo 保留标记", () => {
    expect(replaceBlockText("## 标题", 0, "新标题").markdown).toBe("## 新标题");
    expect(replaceBlockText("- 旧项", 0, "新项").markdown).toBe("- 新项");
    expect(replaceBlockText("1. 旧项", 0, "新项").markdown).toBe("1. 新项");
    expect(replaceBlockText("- [x] 旧", 0, "新").markdown).toBe("- [x] 新");
  });

  it("列表项替换保留嵌套子列表", () => {
    const md = "- 父项\n  - 子项\n- 第二项";
    const { markdown } = replaceBlockText(md, 0, "新父项");
    expect(markdown).toBe("- 新父项\n  - 子项\n- 第二项");
  });

  it("引用块替换保留 > 前缀与多行结构", () => {
    const md = "> 第一行\n> 第二行";
    const { markdown } = replaceBlockText(md, 0, "改写");
    expect(markdown).toBe("> 改写\n> 第二行");
  });

  it("code 块整体替换（多行）", () => {
    const md = "```ts\nconst a = 1;\n```";
    const { markdown } = replaceBlockText(md, 0, "const b = 2;\nconst c = 3;");
    expect(markdown).toBe("```ts\nconst b = 2;\nconst c = 3;\n```");
  });

  it("无效索引原样返回", () => {
    const md = "正文";
    const r = replaceBlockText(md, 5, "x");
    expect(r.markdown).toBe(md);
  });
});

describe("splitBlock", () => {
  it("段落 Enter 分块：前段留当前块，后段成新块", () => {
    const md = "第一段\n\n第二段";
    const { markdown, blocks } = splitBlock(md, 0, "前半", "后半");
    expect(markdown).toBe("前半\n\n后半\n\n第二段");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph", "paragraph"]);
  });

  it("heading 分块继承级别", () => {
    const md = "## 标题";
    const { markdown, blocks } = splitBlock(md, 0, "标题", "续");
    expect(markdown).toBe("## 标题\n\n## 续");
    expect(blocks.map((b) => b.meta.level)).toEqual([2, 2]);
  });

  it("列表项分块生成同级新项（保留列表标记）", () => {
    const md = "- 甲\n- 乙";
    const { markdown } = splitBlock(md, 0, "甲", "丙");
    expect(markdown).toBe("- 甲\n\n- 丙\n- 乙");
  });

  it("todo 分块保留勾选状态", () => {
    const md = "- [x] 完成事项";
    const { markdown } = splitBlock(md, 0, "完成", "事项");
    expect(markdown).toBe("- [x] 完成\n\n- [x] 事项");
  });

  it("code/divider/table 不分块（原样返回）", () => {
    const md = "```ts\nconst a = 1;\n```";
    expect(splitBlock(md, 0, "x", "y").markdown).toBe(md);
  });
});

describe("mergeIntoPrevious", () => {
  it("相邻段落合并：文本空格拼接，类型取前块", () => {
    const md = "第一段\n\n第二段";
    const { markdown } = mergeIntoPrevious(md, 1);
    expect(markdown).toBe("第一段 第二段");
  });

  it("列表项并入列表项（保留列表标记）", () => {
    const md = "- 甲\n- 乙";
    const { markdown } = mergeIntoPrevious(md, 1);
    expect(markdown).toBe("- 甲 乙");
  });

  it("首块无前块：原样返回", () => {
    const md = "只有一段";
    expect(mergeIntoPrevious(md, 0).markdown).toBe(md);
  });
});

describe("deleteBlock", () => {
  it("删除中间块，两侧文本相接", () => {
    const md = "第一段\n\n第二段\n\n第三段";
    const { markdown } = deleteBlock(md, 1);
    expect(markdown).toBe("第一段\n\n第三段");
  });

  it("只剩一个块时清空文本而非删除（保底空段落）", () => {
    const md = "唯一内容";
    const { markdown, blocks } = deleteBlock(md, 0);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("");
    expect(markdown.trim()).toBe("");
  });
});

describe("toggleTodo", () => {
  it("未勾选 → 勾选，勾选 → 未勾选", () => {
    expect(toggleTodo("- [ ] 待办", 0).markdown).toBe("- [x] 待办");
    expect(toggleTodo("- [x] 完成", 0).markdown).toBe("- [ ] 完成");
  });

  it("非 todo 块原样返回", () => {
    const md = "正文";
    expect(toggleTodo(md, 0).markdown).toBe(md);
  });
});

describe("编辑链：重解析后索引可用", () => {
  it("连续编辑（替换 → 分块 → 删除）后 markdown 与块模型一致", () => {
    let md = "# 标题\n\n第一段\n\n第二段";
    md = replaceBlockText(md, 1, "改写").markdown;
    md = splitBlock(md, 1, "改写", "续写").markdown;
    // split 后：0=# 标题, 1=改写, 2=续写, 3=第二段；删除末尾块
    md = deleteBlock(md, 3).markdown;
    expect(md).toBe("# 标题\n\n改写\n\n续写");
    const blocks = parseEditableBlocks(md);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "paragraph"]);
  });
});

describe("编辑操作保留块锚点", () => {
  it("replaceBlockText 保留锚点（追加回行尾）", () => {
    const md = "旧文本 {#keep}";
    const { markdown } = replaceBlockText(md, 0, "新文本");
    expect(markdown).toBe("新文本 {#keep}");
  });

  it("code 块替换保留锚点（追加到内容末行）", () => {
    const md = "```ts\nconst a = 1;\n{#code1}\n```".replace("{#code1}", "// 说明 {#code1}");
    const { markdown } = replaceBlockText(md, 0, "const b = 2;");
    expect(markdown).toBe("```ts\nconst b = 2; {#code1}\n```");
  });

  it("splitBlock 新块不继承锚点，旧块保留", () => {
    const md = "前半后半 {#seg}";
    const { markdown } = splitBlock(md, 0, "前半", "后半");
    expect(markdown).toBe("前半 {#seg}\n\n后半");
  });

  it("mergeIntoPrevious 保留前块锚点", () => {
    const md = "甲 {#a}\n\n乙";
    const { markdown } = mergeIntoPrevious(md, 1);
    expect(markdown).toBe("甲 乙 {#a}");
  });

  it("toggleTodo 保留锚点", () => {
    expect(toggleTodo("- [ ] 待办 {#t}", 0).markdown).toBe("- [x] 待办 {#t}");
  });
});
