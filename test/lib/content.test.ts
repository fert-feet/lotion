// 文档内容适配层单测：BlockNote JSON（旧格式）↔ Markdown（新格式）双向转换，
// 提取标题、坏数据容错。
import { describe, expect, it } from "vitest";
import { extractMarkdownTitle, isBlockNoteJson, toEditorBlocks, toMarkdown } from "@/lib/content";

// 旧格式样本：BlockNote blocks JSON（heading + paragraph）
const OLD_JSON = JSON.stringify([
  { id: "b-0", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "快速开始", styles: {} }] },
  { id: "b-1", type: "paragraph", content: [{ type: "text", text: "这是**重点**内容", styles: {} }] },
  { id: "b-2", type: "bulletListItem", content: [{ type: "text", text: "第一项", styles: {} }] },
]);

describe("isBlockNoteJson", () => {
  it("JSON 数组判定为旧格式；Markdown / 空 / null 判定为否", () => {
    expect(isBlockNoteJson(OLD_JSON)).toBe(true);
    expect(isBlockNoteJson("# 标题\n正文")).toBe(false);
    expect(isBlockNoteJson("")).toBe(false);
    expect(isBlockNoteJson(null)).toBe(false);
    expect(isBlockNoteJson(undefined)).toBe(false);
  });
});

describe("toMarkdown", () => {
  it("BlockNote JSON 转为 Markdown 文本（heading/段落/列表）", () => {
    const md = toMarkdown(OLD_JSON);
    expect(md).toContain("## 快速开始");
    expect(md).toContain("这是**重点**内容");
    expect(md).toContain("- 第一项");
  });

  it("Markdown 原文原样返回（AI 无损读写）", () => {
    const md = "## 小节\n\n正文";
    expect(toMarkdown(md)).toBe(md);
  });

  it("null / undefined / 空串返回空串", () => {
    expect(toMarkdown(null)).toBe("");
    expect(toMarkdown(undefined)).toBe("");
    expect(toMarkdown("")).toBe("");
  });

  it("坏 JSON（截断等）原样返回不抛错", () => {
    const broken = '[{"type":"paragraph","content":[{"type":"text","text":"截断';
    expect(toMarkdown(broken)).toBe(broken);
  });
});

describe("toEditorBlocks", () => {
  it("旧 BlockNote JSON 原样返回（不重复转换）", () => {
    expect(toEditorBlocks(OLD_JSON)).toEqual(JSON.parse(OLD_JSON));
  });

  it("Markdown（新格式）返回 undefined——由编辑器实例 tryParseMarkdownToBlocks 处理", () => {
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
