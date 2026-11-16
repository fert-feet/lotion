import type { SidebarDocument } from "@/lib/seams/doc-store";

export interface VisibleDocRow {
  doc: SidebarDocument;
  level: number;
  expanded: boolean;
  hasChildren: boolean;
  positionInSet: number;
  setSize: number;
}

export interface DocIndex {
  byId: Map<string, SidebarDocument>;
  childrenByParent: Map<string | null, SidebarDocument[]>;
}

/** 一次建立父子索引，避免递归树每层重复 filter/some。 */
export function buildDocIndex(docs: readonly SidebarDocument[]): DocIndex {
  const byId = new Map<string, SidebarDocument>();
  const childrenByParent = new Map<string | null, SidebarDocument[]>();
  for (const doc of docs) {
    byId.set(doc.id, doc);
    const parent = doc.parentDocument ?? null;
    const siblings = childrenByParent.get(parent) ?? [];
    siblings.push(doc);
    childrenByParent.set(parent, siblings);
  }
  return { byId, childrenByParent };
}

/** 当前展开状态下按屏幕阅读顺序展开成扁平行。 */
export function flattenVisibleDocs(
  docs: readonly SidebarDocument[],
  expanded: Record<string, boolean>,
): VisibleDocRow[] {
  const index = buildDocIndex(docs);
  const out: VisibleDocRow[] = [];

  const walk = (parent: string | null, level: number) => {
    const siblings = index.childrenByParent.get(parent) ?? [];
    for (let i = 0; i < siblings.length; i += 1) {
      const doc = siblings[i];
      const children = index.childrenByParent.get(doc.id) ?? [];
      const isExpanded = children.length > 0 && !!expanded[doc.id];
      out.push({
        doc,
        level,
        expanded: isExpanded,
        hasChildren: children.length > 0,
        positionInSet: i + 1,
        setSize: siblings.length,
      });
      if (isExpanded) walk(doc.id, level + 1);
    }
  };

  walk(null, 0);
  return out;
}

/** 当前可见文档 id（键盘导航与滚动定位共用）。 */
export function visibleDocIds(
  docs: readonly SidebarDocument[],
  expanded: Record<string, boolean>,
): string[] {
  return flattenVisibleDocs(docs, expanded).map((row) => row.doc.id);
}

/** 当前文档的祖先 id，从根到父。 */
function ancestorDocIdsFromIndex(
  index: DocIndex,
  documentId: string | null | undefined,
): string[] {
  if (!documentId) return [];
  const { byId } = index;
  const out: string[] = [];
  const seen = new Set<string>([documentId]);
  let current = byId.get(documentId)?.parentDocument ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    out.push(current);
    current = byId.get(current)?.parentDocument ?? null;
  }
  return out.reverse();
}

export function ancestorDocIds(
  docs: readonly SidebarDocument[],
  documentId: string | null | undefined,
): string[] {
  return ancestorDocIdsFromIndex(buildDocIndex(docs), documentId);
}

/** 文档的祖先标题路径；搜索结果用它区分重名页面。 */
export function docBreadcrumb(
  docs: readonly SidebarDocument[],
  documentId: string,
  index: DocIndex = buildDocIndex(docs),
): string[] {
  const { byId } = index;
  return ancestorDocIdsFromIndex(index, documentId)
    .map((id) => byId.get(id)?.title || "未命名");
}

/**
 * 深层树不再无限右移：前四层维持 18px，之后每层只增加 8px。
 * 默认 280px 侧栏中，这能把第 7 层标题从几乎不可见恢复到可读宽度。
 */
export function visualTreeIndent(level: number): number {
  const safeLevel = Math.max(0, Math.floor(level));
  return 4 + Math.min(safeLevel, 4) * 18 + Math.max(0, safeLevel - 4) * 8;
}

/** 当前文档及其全部子孙 id；拖拽时用于在客户端提前拦循环移动。 */
export function descendantDocIds(
  docs: readonly SidebarDocument[],
  documentId: string,
): Set<string> {
  const { childrenByParent } = buildDocIndex(docs);
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const child of childrenByParent.get(id) ?? []) {
      if (out.has(child.id)) continue;
      out.add(child.id);
      walk(child.id);
    }
  };
  walk(documentId);
  return out;
}

/** “移动到…”对话框的候选父页面：排除自身、子孙和归档页。 */
export function movableDocTargets(
  docs: readonly SidebarDocument[],
  documentId: string,
  query = "",
): SidebarDocument[] {
  const excluded = descendantDocIds(docs, documentId);
  excluded.add(documentId);
  const q = query.trim().toLowerCase();
  return docs
    .filter((doc) => !excluded.has(doc.id) && !doc.isArchived)
    .filter((doc) => {
      if (!q) return true;
      const path = docBreadcrumb(docs, doc.id).join(" / ");
      return doc.title.toLowerCase().includes(q) || path.toLowerCase().includes(q);
    })
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}
