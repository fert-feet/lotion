// 全局搜索与侧边栏筛选的语义分工、正文摘要和键盘列表语义。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("搜索交互", () => {
  it("侧边栏图标明确表示筛选当前文档树，不再冒充全局搜索", () => {
    const header = read("src/shell/sidebar/sidebar-header.tsx");
    const sidebar = read("src/shell/sidebar/sidebar.tsx");
    expect(header).toContain('aria-label="筛选当前文档树"');
    expect(header).toContain('placeholder="筛选当前文档树"');
    expect(sidebar).toContain('aria-label="筛选当前文档树"');
  });

  it("全局搜索展示正文摘要、父路径，并采用 listbox/option 与 aria-activedescendant", () => {
    const source = read("components/search-command.tsx");
    expect(source).toContain("doc.snippet");
    expect(source).toContain("documentPath(doc, documents)");
    expect(source).toContain('role="listbox"');
    expect(source).toContain('role="option"');
    expect(source).toContain("aria-activedescendant");
  });

  it("主界面提供跳到正文入口，原生交互控件有全局焦点回退", () => {
    const layout = read("src/shell/main-layout.tsx");
    const shell = read("src/shell/app-shell.tsx");
    const css = read("src/styles/globals.css");
    expect(layout).toContain("跳至正文");
    expect(shell).toContain('id="main-content"');
    expect(css).toContain(':where(button, a, [role="button"]');
  });
});
