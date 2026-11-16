import { describe, expect, it } from "vitest";
import { titleForPath } from "@/src/shell/document-title";

describe("SPA 页面标题", () => {
  it.each([
    ["/", "Lotion — AI 笔记"],
    ["/login", "登录 · Lotion"],
    ["/register", "注册 · Lotion"],
    ["/documents", "笔记 · Lotion"],
    ["/documents/d1", "文档 · Lotion"],
    ["/market", "插件市场 · Lotion"],
    ["/missing", "页面不存在 · Lotion"],
  ])("%s → %s", (path, title) => {
    expect(titleForPath(path)).toBe(title);
  });
});
