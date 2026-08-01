import { describe, expect, it } from "vitest";
import { extractMentions } from "@/lib/mention";

describe("extractMentions", () => {
  it("解析基本提及标记", () => {
    const mentions = extractMentions("帮我总结 [@React学习笔记](doc-123) 的内容");
    expect(mentions).toEqual([{ title: "React学习笔记", id: "doc-123" }]);
  });

  it("解析多个提及，保持出现顺序", () => {
    const mentions = extractMentions("读 [@A](id-1) 和 [@B](id-2) 和 [@C](id-3)");
    expect(mentions).toHaveLength(3);
    expect(mentions[0]).toEqual({ title: "A", id: "id-1" });
    expect(mentions[2]).toEqual({ title: "C", id: "id-3" });
  });

  it("无提及返回空数组", () => {
    expect(extractMentions("普通问题")).toEqual([]);
    expect(extractMentions("")).toEqual([]);
  });

  it("标题可包含括号等特殊字符", () => {
    const mentions = extractMentions("[@标题(含括号)](id-1)");
    expect(mentions).toEqual([{ title: "标题(含括号)", id: "id-1" }]);
  });

  it("同一文档 id 重复提及只保留一次", () => {
    const mentions = extractMentions("[@A](id-1) 和 [@B](id-1)");
    expect(mentions).toHaveLength(1);
    expect(mentions[0].title).toBe("A"); // 保留首次
  });

  it("空标题或非法 id 跳过", () => {
    expect(extractMentions("[@](id-1)")).toEqual([]);
    expect(extractMentions("[@标题](!)")).toEqual([]);
  });

  it("胶囊文本与自然语言混排", () => {
    const text = "帮我总结 [@React学习](doc-1) 和 [@前端路线](doc-2) 这两篇笔记，重点对比异同";
    const mentions = extractMentions(text);
    expect(mentions).toHaveLength(2);
  });
});
