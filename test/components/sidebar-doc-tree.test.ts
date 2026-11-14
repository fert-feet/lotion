// 侧边栏文档树的**可访问性/密度**守卫（静态检查 + 行为）。
//
// 背景（2026-11）：行是 `role="button" tabIndex={-1}` 且只有 onClick ——
// 等于把文档树从键盘/读屏用户手里整个拿走；注释写"行高 32px、缩进 22px"，
// 类名却是 h-7（28px）+ level*16；hover 时时间戳与两个操作按钮用 hidden/flex 互相
// 顶替，标题右边界会被挤动约 44px（侧边栏是鼠标最频繁的区域）。
//
// 这里钉三件事：① 行必须键盘可达；② 行高/缩进与设计稿一致；③ 尾部区固定宽度、零重排。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const FILE = path.join(ROOT, "src/shell/sidebar/doc-tree.tsx");
const source = fs.readFileSync(FILE, "utf8");

describe("侧边栏文档树", () => {
  it("行键盘可达：treeitem + tabIndex=0 + Enter/Space 打开 + 方向键展开", () => {
    expect(source, "行应当是 role=treeitem（不是 role=button）").toContain('role="treeitem"');
    expect(source, "行必须能被 Tab 聚焦（此前是 tabIndex={-1}）").toContain("tabIndex={0}");
    expect(source, "缺少 Enter/Space 打开").toMatch(/e\.key === "Enter"/);
    expect(source, '缺少空格键打开（" "）').toContain('e.key === " "');
    expect(source, "缺少 ArrowRight 展开").toContain('"ArrowRight"');
    expect(source, "缺少 ArrowLeft 收起").toContain('"ArrowLeft"');
    // aria：层级与状态必须暴露给读屏
    expect(source).toContain("aria-level={level + 1}");
    expect(source).toContain("aria-selected={active}");
    expect(source).toMatch(/aria-expanded=\{hasChildren \? expanded : undefined\}/);
    // 焦点环：没有它键盘用户不知道自己停在哪一行
    expect(source, "缺少 focus-visible 焦点环").toMatch(/focus-visible:outline/);
  });

  it("行高与缩进对齐设计稿：h-8（32px）+ level*22", () => {
    expect(source, "行高应为 h-8（32px）——此前误写成 h-7（28px）").toMatch(/flex h-8 /);
    expect(source, "缩进步进应为 22px").toContain("level * 22");
    expect(source, "不要再出现 28px 行的 h-7").not.toMatch(/flex h-7 /);
  });

  it("尾部区固定宽度、只做透明度切换（悬停不再重排标题）", () => {
    // 时间戳与操作按钮共存，不再用 group-hover:hidden / group-hover:flex 互相顶替
    expect(source, "不要再用 group-hover:hidden 顶掉时间戳").not.toContain("group-hover:hidden");
    expect(source, "不要再用 group-hover:flex 顶出按钮").not.toContain("group-hover:flex");
    expect(source, "尾部应为固定宽度占位（w-[52px]）").toContain("w-[52px]");
    expect(source, "标题需要为尾部区预留空间（pr-[52px]）").toContain("pr-[52px]");
    expect(source, "切换应走透明度").toContain("group-hover:opacity-100");
    // 键盘聚焦到行内按钮时，尾部也要显形（否则焦点落在看不见的按钮上）
    expect(source, "缺少 group-focus-within 显形").toContain("group-focus-within:opacity-100");
  });

  it("树容器声明 role=tree（在 sidebar.tsx 里）", () => {
    const sidebar = fs.readFileSync(path.join(ROOT, "src/shell/sidebar/sidebar.tsx"), "utf8");
    expect(sidebar, "文档树容器缺少 role=tree").toMatch(/role="tree"/);
  });
});
