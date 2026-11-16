import { describe, expect, it } from "vitest";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import {
  descendantDocIds,
  docBreadcrumb,
  flattenVisibleDocs,
  movableDocTargets,
  toggleVisibleSelection,
  visualTreeIndent,
  visibleDocIds,
} from "@/src/shell/sidebar/doc-tree-model";

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

const docs = [
  doc("a"),
  doc("a1", "a"),
  doc("a1x", "a1"),
  doc("b"),
  doc("b1", "b"),
];

describe("侧边栏扁平树模型", () => {
  it("按父子顺序展开，并带上 level / posinset / setsize", () => {
    const rows = flattenVisibleDocs(docs, { a: true, a1: true, b: true });
    expect(rows.map((row) => row.doc.id)).toEqual(["a", "a1", "a1x", "b", "b1"]);
    expect(rows[0]).toMatchObject({ level: 0, positionInSet: 1, setSize: 2, hasChildren: true });
    expect(rows[2]).toMatchObject({ level: 2, positionInSet: 1, setSize: 1 });
  });

  it("收起父节点后不返回其子孙，visibleDocIds 与扁平行一致", () => {
    const expanded = { a: false, b: true };
    expect(visibleDocIds(docs, expanded)).toEqual(["a", "b", "b1"]);
  });

  it("搜索结果面包屑从根到父排列", () => {
    expect(docBreadcrumb(docs, "a1x")).toEqual(["a", "a1"]);
    expect([...descendantDocIds(docs, "a")]).toEqual(["a1", "a1x"]);
    expect(movableDocTargets(docs, "a").map((item) => item.id)).toEqual(["b", "b1"]);
    expect(movableDocTargets(docs, "a", "b1").map((item) => item.id)).toEqual(["b1"]);
  });

  it("深层缩进在第四层后压缩，不再无限右移", () => {
    expect(visualTreeIndent(0)).toBe(4);
    expect(visualTreeIndent(4)).toBe(76);
    expect(visualTreeIndent(5)).toBe(84);
    expect(visualTreeIndent(8)).toBe(108);
  });

  it("全选可见项与清空可见项保持其他选择不变", () => {
    expect([...toggleVisibleSelection(new Set(["x"]), ["a", "b"])]).toEqual(["x", "a", "b"]);
    expect([...toggleVisibleSelection(new Set(["x", "a", "b"]), ["a", "b"])]).toEqual(["x"]);
  });
});
