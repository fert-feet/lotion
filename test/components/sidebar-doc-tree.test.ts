// 侧边栏文档树的键盘、密度与操作守卫。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const FILE = path.join(ROOT, "src/shell/sidebar/doc-tree.tsx");
const source = fs.readFileSync(FILE, "utf8");

describe("侧边栏文档树", () => {
  it("行键盘可达：treeitem + roving tabindex + Enter/Space + 完整方向键", () => {
    expect(source).toContain('role="treeitem"');
    expect(source).toContain("tabIndex={focused ? 0 : -1}");
    expect(source).toContain('event.key === "Enter"');
    expect(source).toContain('event.key === " "');
    expect(source).toContain('"ArrowRight"');
    expect(source).toContain('"ArrowLeft"');
    expect(source).toContain('"ArrowDown"');
    expect(source).toContain('"ArrowUp"');
    expect(source).toContain('"Home"');
    expect(source).toContain('"End"');
    expect(source).toContain('"F2"');
    expect(source).toContain("aria-level={level + 1}");
    expect(source).toContain("aria-posinset={positionInSet}");
    expect(source).toContain("aria-setsize={setSize}");
    expect(source).toContain("aria-selected={active}");
    expect(source).toMatch(/aria-expanded=\{hasChildren \? expanded : undefined\}/);
    expect(source).toMatch(/focus-visible:outline/);
  });

  it("树使用扁平模型与虚拟窗口，不再递归重复扫描 docs", () => {
    expect(source).toContain("flattenVisibleDocs(docs, expanded)");
    expect(source).toContain("VIRTUAL_THRESHOLD");
    expect(source).toContain("rows.slice(range.start, range.end)");
    expect(source).not.toContain("<DocTree");
    expect(source).toContain("const VIRTUAL_THRESHOLD = 500");
    expect(source).toContain("contentVisibility");
    expect(source).toContain("containIntrinsicSize");
  });

  it("深层缩进压缩，尾部只保留一个操作入口且键盘/触屏可见", () => {
    expect(source).toContain("visualTreeIndent(level)");
    expect(source).toContain("pr-14");
    expect(source).not.toContain("pr-[52px]");
    expect(source).toContain("group-focus-within:opacity-100");
    expect(source).toContain("[@media(hover:none)]:opacity-100");
    expect(source).toContain("更多操作");
  });

  it("文档操作覆盖重命名、收藏、移动和归档", () => {
    for (const text of ["新建子笔记", "重命名", "收藏", "移动到…", "移入回收站"]) {
      expect(source).toContain(text);
    }
    expect(source).toContain("draggable={!batchMode && !renaming}");
    expect(source).toContain("拖动「${title}」更改位置");
    expect(source).toContain("GripVertical");
    expect(source).toContain("isImeConfirmingKey");
    expect(source).toContain('dataTransfer.setData("text/lotion-doc-id"');
  });

  it("搜索结果使用真实按钮并展示祖先面包屑", () => {
    expect(source).toContain("docBreadcrumb(docs, doc.id, index)");
    expect(source).toContain('aria-current={active ? "page" : undefined}');
    expect(source).toContain('path.join(" / ")');
  });
});
