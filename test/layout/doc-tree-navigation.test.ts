// 文档树可见顺序与祖先路径的纯函数守卫。
import { describe, expect, it } from "vitest";
import { ancestorDocIds, visibleDocIds } from "@/src/shell/sidebar/doc-tree";
import type { SidebarDocument } from "@/lib/seams/doc-store";

function doc(id: string, parentDocument: string | null = null): SidebarDocument {
  return {
    id,
    title: id,
    userId: "u1",
    isArchived: false,
    isDraft: false,
    parentDocument,
    icon: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const docs = [doc("root"), doc("a", "root"), doc("a1", "a"), doc("b", "root"), doc("other")];

describe("文档树导航", () => {
  it("可见 id 跟随展开状态，并保持深度优先顺序", () => {
    expect(visibleDocIds(docs, {})).toEqual(["root", "other"]);
    expect(visibleDocIds(docs, { root: true })).toEqual(["root", "a", "b", "other"]);
    expect(visibleDocIds(docs, { root: true, a: true })).toEqual([
      "root",
      "a",
      "a1",
      "b",
      "other",
    ]);
  });

  it("祖先路径从根到父排列，坏引用不会死循环", () => {
    expect(ancestorDocIds(docs, "a1")).toEqual(["root", "a"]);
    expect(ancestorDocIds(docs, "root")).toEqual([]);
    expect(ancestorDocIds([doc("x", "y"), doc("y", "x")], "x")).toEqual(["y"]);
  });
});
