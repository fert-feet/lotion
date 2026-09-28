// 文档内容适配层单测（重构阶段 B）：规范存储为 BlockNote JSON，
// toMarkdown（JSON→Markdown，服务端 server-util）与 toBlocks（Markdown→JSON）双向转换、
// 提取标题、坏数据容错。
import { describe, expect, it } from "vitest";
import { extractMarkdownTitle, isBlockNoteJson, normalizeChecklistBlocks, toEditorBlocks } from "@/lib/content";
import { appendMarkdownToDocument, toBlocks, toMarkdown } from "@/lib/content-server";

// 存量样本：BlockNote blocks JSON（heading + paragraph + 列表）
const OLD_JSON = JSON.stringify([
  { id: "b-0", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "快速开始", styles: {} }] },
  { id: "b-1", type: "paragraph", content: [{ type: "text", text: "这是**重点**内容", styles: {} }] },
  { id: "b-2", type: "bulletListItem", content: [{ type: "text", text: "第一项", styles: {} }] },
]);

describe("isBlockNoteJson", () => {
  it("JSON 数组判定为 BlockNote JSON；Markdown / 空 / null 判定为否", () => {
    expect(isBlockNoteJson(OLD_JSON)).toBe(true);
    expect(isBlockNoteJson("# 标题\n正文")).toBe(false);
    expect(isBlockNoteJson("")).toBe(false);
    expect(isBlockNoteJson(null)).toBe(false);
    expect(isBlockNoteJson(undefined)).toBe(false);
  });
});

describe("toMarkdown", () => {
  it("BlockNote JSON 转为 Markdown 文本（heading/段落/列表）", async () => {
    const md = await toMarkdown(OLD_JSON);
    expect(md).toContain("## 快速开始");
    expect(md).toContain("这是**重点**内容");
    expect(md).toContain("* 第一项");
  });

  it("Markdown 原文原样返回（存量旧数据）", async () => {
    const md = "## 小节\n\n正文";
    expect(await toMarkdown(md)).toBe(md);
  });

  it("null / undefined / 空串返回空串", async () => {
    expect(await toMarkdown(null)).toBe("");
    expect(await toMarkdown(undefined)).toBe("");
    expect(await toMarkdown("")).toBe("");
  });

  it("空 JSON 数组返回空串", async () => {
    expect(await toMarkdown("[]")).toBe("");
  });

  it("坏 JSON（截断等）原样返回不抛错", async () => {
    const broken = '[{"type":"paragraph","content":[{"type":"text","text":"截断';
    expect(await toMarkdown(broken)).toBe(broken);
  });
});

describe("toBlocks", () => {
  it("Markdown 转 blocks：生成真实块 ID、类型正确", async () => {
    const blocks = await toBlocks("## 小节\n\n正文 **加粗**\n\n- 列表项");
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].id).toBeTruthy();
    expect(blocks[1].type).toBe("paragraph");
    expect(blocks[2].type).toBe("bulletListItem");
    // 加粗样式被正确解析（paragraph.content 为 inline content 数组）
    const paragraphContent = blocks[1]?.content;
    expect(Array.isArray(paragraphContent)).toBe(true);
    expect(JSON.stringify(paragraphContent)).toContain('"bold":true');
  });

  it("BlockNote JSON 原样返回（不重复转换）", async () => {
    expect(await toBlocks(OLD_JSON)).toEqual(JSON.parse(OLD_JSON));
  });

  it("空内容 / null 返回空数组", async () => {
    expect(await toBlocks(null)).toEqual([]);
    expect(await toBlocks("")).toEqual([]);
    expect(await toBlocks("   ")).toEqual([]);
  });
});

describe("toEditorBlocks", () => {
  it("BlockNote JSON 原样返回（客户端编辑器初始内容）", () => {
    expect(toEditorBlocks(OLD_JSON)).toEqual(JSON.parse(OLD_JSON));
  });

  it("Markdown 返回 undefined——由编辑器实例 tryParseMarkdownToBlocks 处理", () => {
    expect(toEditorBlocks("## 小节\n\n正文")).toBeUndefined();
  });

  it("空内容返回 undefined", () => {
    expect(toEditorBlocks(null)).toBeUndefined();
    expect(toEditorBlocks("")).toBeUndefined();
  });

  it("坏数据返回 undefined 不抛错", () => {
    expect(toEditorBlocks("{" as string)).toBeUndefined();
  });
});

describe("extractMarkdownTitle", () => {
  it("提取首个 # 一级标题", () => {
    expect(extractMarkdownTitle("# 文档标题\n\n正文")).toBe("文档标题");
    expect(extractMarkdownTitle("开头段落\n\n# 后面的标题\n\n正文")).toBe("后面的标题");
  });

  it("无一级标题（含 ## 二级）返回 null", () => {
    expect(extractMarkdownTitle("## 小节\n\n正文")).toBeNull();
    expect(extractMarkdownTitle("纯文本")).toBeNull();
    expect(extractMarkdownTitle("")).toBeNull();
  });
});

describe("normalizeChecklistBlocks", () => {
  it("旧版 `[ ]`/`[x]` bulletListItem 转为 checkListItem，剥离前缀、设置勾选态", () => {
    const blocks = [
      { id: "b-0", type: "paragraph", content: [{ type: "text", text: "前言", styles: {} }] },
      {
        id: "b-1",
        type: "bulletListItem",
        content: [{ type: "text", text: "[ ] 确定搬家日期，预约搬家公司或车辆", styles: {} }],
      },
      {
        id: "b-2",
        type: "bulletListItem",
        content: [{ type: "text", text: "[x] 处理闲置物品", styles: {} }],
      },
      // 链接 `[label](url)` 不应误判
      {
        id: "b-3",
        type: "bulletListItem",
        content: [{ type: "text", text: "[查看文档](https://example.com)", styles: {} }],
      },
    ];
    const out = normalizeChecklistBlocks(blocks as never);
    expect(out[0].type).toBe("paragraph");
    expect(out[1].type).toBe("checkListItem");
    expect((out[1].props as { checked: boolean }).checked).toBe(false);
    expect((out[1].content as Array<{ text: string }>)[0].text).toBe("确定搬家日期，预约搬家公司或车辆");
    expect(out[2].type).toBe("checkListItem");
    expect((out[2].props as { checked: boolean }).checked).toBe(true);
    expect(out[3].type).toBe("bulletListItem"); // 链接不误判
  });

  it("递归处理嵌套 children 中的坏任务项", () => {
    const blocks = [
      {
        id: "p",
        type: "paragraph",
        content: [{ type: "text", text: "父", styles: {} }],
        children: [
          { id: "c", type: "bulletListItem", content: [{ type: "text", text: "[ ] 子任务", styles: {} }] },
        ],
      },
    ];
    const out = normalizeChecklistBlocks(blocks as never);
    expect((out[0].children as Array<{ type: string }>)[0].type).toBe("checkListItem");
  });
});

describe("toBlocks 对遗留坏数据归一化", () => {
  it("既有 JSON 中的 `[ ]` bulletListItem 在服务端转换时为 checkListItem", async () => {
    const legacy = JSON.stringify([
      { id: "b-1", type: "bulletListItem", content: [{ type: "text", text: "[ ] 确定搬家日期", styles: {} }] },
    ]);
    const blocks = await toBlocks(legacy);
    expect(blocks[0].type).toBe("checkListItem");
    expect((blocks[0].props as { checked: boolean }).checked).toBe(false);
  });
});

describe("appendMarkdownToDocument（AI 回答插入文档）", () => {
  it("空文档：追加内容成为正文（规范化为 BlockNote JSON）", async () => {
    const out = await appendMarkdownToDocument(null, "# 标题\n\n正文");
    const blocks = JSON.parse(out) as Array<{ type: string }>;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
    expect(out).toContain("标题");
  });

  it("Markdown 存量文档：原文与追加内容都在（追加不覆盖）", async () => {
    const out = await appendMarkdownToDocument("原有一段话", "追加的一句");
    expect(out).toContain("原有一段话");
    expect(out).toContain("追加的一句");
    expect(out.trim().startsWith("[")).toBe(true); // 结果是 JSON
  });

  it("BlockNote JSON 文档：追加后仍是合法 JSON 且块数增加", async () => {
    const base = JSON.stringify([
      { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "第一段", styles: {} }], children: [] },
    ]);
    const out = await appendMarkdownToDocument(base, "第二段");
    const blocks = JSON.parse(out) as Array<{ id?: string }>;
    expect(blocks.length).toBe(2);
    expect(blocks[0].id).toBe("b1"); // 原有块 ID 保留（无损）
    expect(out).toContain("第二段");
  });

  it("空/空白追加不破坏原文", async () => {
    const base = JSON.stringify([{ id: "b1", type: "paragraph", props: {}, content: [], children: [] }]);
    expect(await appendMarkdownToDocument(base, "   ")).toBe(base);
  });

  it("超长内容按上限截断，不把库灌爆", async () => {
    const out = await appendMarkdownToDocument(null, "字".repeat(100), { maxChars: 10 });
    expect(out.length).toBeLessThan(2000);
  });
});
