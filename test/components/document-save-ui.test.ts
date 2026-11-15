// 标题编辑与保存状态的静态结构守卫。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("文档保存 UI", () => {
  it("正文页同时挂正文与标题自动保存，并展示失败重试和恢复入口", () => {
    const page = read("src/pages/document.tsx");
    expect(page).toContain("useDocumentAutosave");
    expect(page.match(/useDocumentAutosave\(/g)).toHaveLength(2);
    expect(page).toContain("保存失败：");
    expect(page).toContain("重试");
    expect(page).toContain("发现本地未保存内容");
  });

  it("标题只有一个编辑入口：正文工具栏可编辑，顶栏只读定位", () => {
    const toolbar = read("components/toobar.tsx");
    const navbarTitle = read("src/shell/title.tsx");

    expect(toolbar).toContain('aria-label="文档标题"');
    expect(toolbar).toContain('aria-label="编辑文档标题"');
    expect(toolbar).toContain("onTitleCommit");
    expect(navbarTitle).not.toContain("docStore.update");
    expect(navbarTitle).not.toContain("contentEditable");
    expect(navbarTitle).not.toContain("<Input");
  });
});
