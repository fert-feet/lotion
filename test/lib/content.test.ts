// 文档内容适配层单测（重构阶段 B）：规范存储为 BlockNote JSON，
// toMarkdown（JSON→Markdown，服务端 server-util）与 toBlocks（Markdown→JSON）双向转换、
// 提取标题、坏数据容错。
import { describe, expect, it } from "vitest";
import { extractMarkdownTitle, isBlockNoteJson, toEditorBlocks } from "@/lib/content";
import { toBlocks, toMarkdown } from "@/lib/content-server";

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
