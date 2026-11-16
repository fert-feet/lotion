"use client";

// 文档树是侧边栏的主工作区：扁平可视行、父子索引与虚拟窗口都在这里收口。
// 行本身仍是一个 Tab 停点，方向键导航；操作收进单个「更多」菜单，触屏与键盘共用同一入口。
import { useNavigate, useParams } from "react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  FileIcon,
  MoreHorizontal,
  PenLine,
  Plus,
  Star,
  Trash,
} from "@/components/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import {
  buildDocIndex,
  docBreadcrumb,
  flattenVisibleDocs,
  visualTreeIndent,
} from "./doc-tree-model";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export { ancestorDocIds, visibleDocIds } from "./doc-tree-model";

const VIRTUAL_THRESHOLD = 120;
const ROW_HEIGHT = 32;
const OVERSCAN = 8;

/** 相对时间（DSH 紧凑格式） */
function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d === 1) return "昨天";
  if (d < 7) return `${d}天前`;
  const date = new Date(t);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

interface DocRowProps {
  doc: SidebarDocument;
  active: boolean;
  level: number;
  positionInSet: number;
  setSize: number;
  expanded: boolean;
  hasChildren: boolean;
  pinned: boolean;
  renaming: boolean;
  renameDraft: string;
  dragging: boolean;
  draggedId: string | null;
  batchMode: boolean;
  checked: boolean;
  focused: boolean;
  entering: boolean;
  canDrop: (draggedId: string, targetId: string) => boolean;
  onExpand: () => void;
  onOpen: () => void;
  onCreateChild: () => void;
  onArchive: () => void;
  onToggleCheck: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRenameStart: (id: string, title: string) => void;
  onRenameDraft: (value: string) => void;
  onRenameCommit: (id: string) => void;
  onRenameCancel: () => void;
  onMove: (id: string, parentDocument: string | null) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onFocusRow: (id: string) => void;
  onMoveFocus: (id: string, action: TreeFocusAction) => void;
}

export type TreeFocusAction = "next" | "previous" | "first" | "last" | "parent";

const DocRow = memo(function DocRow({
  doc,
  active,
  level,
  positionInSet,
  setSize,
  expanded,
  hasChildren,
  pinned,
  renaming,
  renameDraft,
  dragging,
  draggedId,
  batchMode,
  checked,
  focused,
  entering,
  canDrop,
  onExpand,
  onOpen,
  onCreateChild,
  onArchive,
  onToggleCheck,
  onTogglePin,
  onRenameStart,
  onRenameDraft,
  onRenameCommit,
  onRenameCancel,
  onMove,
  onDragStart,
  onDragEnd,
  onFocusRow,
  onMoveFocus,
}: DocRowProps) {
  const docStore = useDocStore();
  const actor = useActor();
  const [now, setNow] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setNow(Date.now());
  }, []);

  const title = doc.title || "无标题";
  const indent = visualTreeIndent(level);
  const acceptsDrop =
    draggedId !== null &&
    draggedId !== doc.id &&
    canDrop(draggedId, doc.id);

  return (
    <div
      role="treeitem"
      tabIndex={focused ? 0 : -1}
      aria-level={level + 1}
      aria-posinset={positionInSet}
      aria-setsize={setSize}
      aria-selected={active}
      aria-expanded={hasChildren ? expanded : undefined}
      data-doc-id={doc.id}
      data-drop-target={dropActive || undefined}
      data-dragging={dragging || undefined}
      draggable={!batchMode && !renaming}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/lotion-doc-id", doc.id);
        onDragStart(doc.id);
      }}
      onDragEnd={() => {
        setDropActive(false);
        onDragEnd();
      }}
      onDragOver={(event) => {
        if (!acceptsDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        if (!acceptsDrop) return;
        event.preventDefault();
        event.stopPropagation();
        setDropActive(false);
        const id = event.dataTransfer.getData("text/lotion-doc-id") || draggedId;
        if (id) onMove(id, doc.id);
      }}
      onFocus={() => onFocusRow(doc.id)}
      onClick={() => {
        if (batchMode) {
          onToggleCheck(doc.id);
          return;
        }
        if (!renaming) onOpen();
      }}
      onKeyDown={(event) => {
        if (renaming) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (batchMode) onToggleCheck(doc.id);
          else onOpen();
        } else if (event.key === "F2") {
          event.preventDefault();
          onRenameStart(doc.id, doc.title);
        } else if (event.key === "ArrowRight" && hasChildren && !expanded) {
          event.preventDefault();
          onExpand();
        } else if (event.key === "ArrowLeft" && hasChildren && expanded) {
          event.preventDefault();
          onExpand();
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onMoveFocus(doc.id, "next");
        } else if (event.key === "ArrowLeft" && doc.parentDocument) {
          event.preventDefault();
          onMoveFocus(doc.id, "parent");
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          onMoveFocus(doc.id, "next");
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          onMoveFocus(doc.id, "previous");
        } else if (event.key === "Home") {
          event.preventDefault();
          onMoveFocus(doc.id, "first");
        } else if (event.key === "End") {
          event.preventDefault();
          onMoveFocus(doc.id, "last");
        }
      }}
      onMouseEnter={() => {
        docStore.prefetch?.(actor, doc.id);
      }}
      style={{ paddingLeft: indent }}
      className={cn(
        "group relative flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-control px-1.5 text-ui leading-5 text-shell-label-primary",
        "transition-[background-color,opacity,box-shadow] duration-150 ease-[var(--ds-ease-out)]",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-shell-accent",
        active ? "bg-shell-row-active-accent font-medium" : "hover:bg-shell-row-hover",
        entering && "animate-[sidebar-row-in_140ms_var(--ds-ease-out)]",
        dragging && "opacity-45",
        dropActive && "bg-shell-row-active-accent ring-1 ring-inset ring-shell-accent",
      )}
    >
      {level > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 w-px bg-shell-border"
          style={{ left: indent - 7 }}
        />
      )}

      {batchMode && (
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleCheck(doc.id)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`选择「${title}」`}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-shell-accent"
        />
      )}

      <span className="flex h-5 w-4 flex-none items-center justify-center text-shell-label-tertiary">
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={expanded ? `收起「${title}」` : `展开「${title}」`}
            onClick={(event) => {
              event.stopPropagation();
              onExpand();
            }}
            className="flex size-4 cursor-pointer items-center justify-center rounded-control hover:bg-shell-row-hover"
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-150 ease-[var(--ds-ease-in-out)]",
                expanded && "rotate-90",
              )}
            />
          </button>
        ) : null}
      </span>

      <span className="flex h-5 w-4 flex-none items-center justify-center">
        {doc.icon ? (
          <span className="text-lead leading-none">{doc.icon}</span>
        ) : (
          <FileIcon className="h-4 w-4 text-shell-label-tertiary" strokeWidth={1.75} />
        )}
      </span>

      {renaming ? (
        <input
          autoFocus
          value={renameDraft}
          aria-label="文档标题"
          onChange={(event) => onRenameDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={() => onRenameCommit(doc.id)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              onRenameCommit(doc.id);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onRenameCancel();
            }
          }}
          className="h-6 min-w-0 flex-1 rounded-control hairline border-shell-border-l2 bg-card px-1.5 text-ui text-shell-label-primary outline-none focus:border-shell-accent/60"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate pr-9 text-ui leading-5">
          {title}
        </span>
      )}

      <span className="absolute inset-y-0 right-1.5 flex w-8 items-center justify-end">
        <span className="pointer-events-none absolute inset-0 flex items-center justify-end text-caption leading-5 text-shell-label-tertiary transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
          {relativeTime(doc.updatedAt, now)}
        </span>

        <span className="relative flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`「${title}」的更多操作`}
                onClick={(event) => event.stopPropagation()}
                className="touch-target flex size-7 cursor-pointer items-center justify-center rounded-control bg-transparent p-0 text-shell-label-tertiary hover:bg-shell-row-active hover:text-shell-label-primary"
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="w-52">
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onCreateChild();
                }}
                className="cursor-pointer"
              >
                <Plus className="mr-2 h-4 w-4" />
                新建子笔记
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onRenameStart(doc.id, doc.title);
                }}
                className="cursor-pointer"
              >
                <PenLine className="mr-2 h-4 w-4" />
                重命名
                <span className="ml-auto text-caption text-shell-label-caption">F2</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onTogglePin(doc.id);
                }}
                className="cursor-pointer"
              >
                <Star className={cn("mr-2 h-4 w-4", pinned && "text-shell-accent")} />
                {pinned ? "取消收藏" : "收藏"}
              </DropdownMenuItem>
              {doc.parentDocument && (
                <DropdownMenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onMove(doc.id, null);
                  }}
                  className="cursor-pointer"
                >
                  <ArrowRight className="mr-2 h-4 w-4" />
                  移到根目录
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onArchive();
                }}
                className="cursor-pointer"
              >
                <Trash className="mr-2 h-4 w-4" />
                移入回收站
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </span>
    </div>
  );
});

interface DocTreeProps {
  docs: SidebarDocument[];
  batchMode?: boolean;
  selected?: Set<string>;
  pinnedIds: Set<string>;
  expanded: Record<string, boolean>;
  focusedId?: string | null;
  renamingId: string | null;
  renameDraft: string;
  draggedId: string | null;
  onToggleCheck?: (id: string) => void;
  onExpandChange?: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRenameStart: (id: string, title: string) => void;
  onRenameDraft: (value: string) => void;
  onRenameCommit: (id: string) => void;
  onRenameCancel: () => void;
  onMove: (id: string, parentDocument: string | null) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onFocusRow?: (id: string) => void;
  onMoveFocus?: (id: string, action: TreeFocusAction) => void;
}

export function DocTree({
  docs,
  batchMode,
  selected,
  pinnedIds,
  expanded,
  focusedId = null,
  renamingId,
  renameDraft,
  draggedId,
  onToggleCheck,
  onExpandChange,
  onTogglePin,
  onRenameStart,
  onRenameDraft,
  onRenameCommit,
  onRenameCancel,
  onMove,
  onDragStart,
  onDragEnd,
  onFocusRow = () => {},
  onMoveFocus = () => {},
}: DocTreeProps) {
  const params = useParams();
  const navigate = useNavigate();
  const docStore = useDocStore();
  const { user } = useUser();
  const triggerSidebar = useRefresh((s) => s.triggerSidebar);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState({ start: 0, end: VIRTUAL_THRESHOLD });
  const rows = useMemo(() => flattenVisibleDocs(docs, expanded), [docs, expanded]);
  const previousRowIds = useRef<Set<string>>(new Set());
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());
  const rowIndexById = useMemo(
    () => new Map(rows.map((row, index) => [row.doc.id, index])),
    [rows],
  );
  const descendantCache = useMemo(
    () => buildDocIndex(docs),
    [docs],
  );
  const descendantsBySource = useRef(new Map<string, Set<string>>());
  useEffect(() => {
    descendantsBySource.current.clear();
  }, [descendantCache]);

  useEffect(() => {
    const next = new Set(rows.map((row) => row.doc.id));
    const added = new Set([...next].filter((id) => !previousRowIds.current.has(id)));
    previousRowIds.current = next;
    setEnteringIds(added);
  }, [rows]);

  const canDrop = useCallback((sourceId: string, targetId: string) => {
    const source = descendantCache.byId.get(sourceId);
    const target = descendantCache.byId.get(targetId);
    if (!source || !target) return false;
    if (source.parentDocument === target.id) return false;
    let descendants = descendantsBySource.current.get(sourceId);
    if (!descendants) {
      descendants = new Set<string>();
      const walk = (id: string) => {
        for (const child of descendantCache.childrenByParent.get(id) ?? []) {
          descendants!.add(child.id);
          walk(child.id);
        }
      };
      walk(sourceId);
      descendantsBySource.current.set(sourceId, descendants);
    }
    return !descendants.has(targetId);
  }, [descendantCache]);

  useEffect(() => {
    if (rows.length <= VIRTUAL_THRESHOLD) {
      setRange({ start: 0, end: rows.length });
      return;
    }
    const scroller = rootRef.current?.closest<HTMLElement>("[data-sidebar-scroll]");
    if (!scroller) return;
    const update = () => {
      const rootRect = rootRef.current?.getBoundingClientRect();
      if (!rootRect) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const rootTop = rootRect.top - scrollerRect.top + scroller.scrollTop;
      const visibleTop = Math.max(0, scroller.scrollTop - rootTop);
      const start = Math.max(0, Math.floor(visibleTop / ROW_HEIGHT) - OVERSCAN);
      const end = Math.min(
        rows.length,
        Math.ceil((visibleTop + scroller.clientHeight) / ROW_HEIGHT) + OVERSCAN,
      );
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [rows.length]);

  useEffect(() => {
    if (!focusedId) return;
    const index = rowIndexById.get(focusedId);
    if (index === undefined) return;
    if (index < range.start + OVERSCAN || index >= range.end - OVERSCAN) {
      const scroller = rootRef.current?.closest<HTMLElement>("[data-sidebar-scroll]");
      if (!scroller) return;
      scroller.scrollTop = Math.max(0, index * ROW_HEIGHT - scroller.clientHeight / 2);
    }
  }, [focusedId, range.end, range.start, rowIndexById]);

  const visible = rows.length > VIRTUAL_THRESHOLD ? rows.slice(range.start, range.end) : rows;
  const topPad = rows.length > VIRTUAL_THRESHOLD ? range.start * ROW_HEIGHT : 0;
  const bottomPad =
    rows.length > VIRTUAL_THRESHOLD ? (rows.length - range.end) * ROW_HEIGHT : 0;

  return (
    <div ref={rootRef} data-doc-tree>
      {topPad > 0 && <div aria-hidden="true" style={{ height: topPad }} />}
      {visible.map((row) => {
        const { doc } = row;
        const onCreateChild = () => {
          if (!user) return;
          const promise = docStore.create({ userId: user.id }, "未命名", doc.id).then(
            (documentId) => {
              if (!row.expanded) onExpandChange?.(doc.id);
              triggerSidebar();
              navigate(`/documents/${documentId}`);
            },
          );
          toast.promise(promise, {
            loading: "正在新建笔记...",
            success: "已新建笔记",
            error: "新建笔记失败，请稍后重试",
          });
        };
        const onArchive = () => {
          if (!user) return;
          const promise = docStore.archive({ userId: user.id }, doc.id).then(() => {
            triggerSidebar();
            if (params.documentId === doc.id) navigate("/documents");
          });
          toast.promise(promise, {
            loading: "正在移入回收站...",
            success: "已移入回收站",
            error: "移入回收站失败",
          });
        };
        return (
          <DocRow
            key={doc.id}
            doc={doc}
            active={params.documentId === doc.id}
            level={row.level}
            positionInSet={row.positionInSet}
            setSize={row.setSize}
            expanded={row.expanded}
            hasChildren={row.hasChildren}
            pinned={pinnedIds.has(doc.id)}
            renaming={renamingId === doc.id}
            renameDraft={renameDraft}
            dragging={draggedId === doc.id}
            draggedId={draggedId}
            batchMode={!!batchMode}
            checked={!!selected?.has(doc.id)}
            focused={focusedId === doc.id}
            entering={enteringIds.has(doc.id)}
            canDrop={canDrop}
            onExpand={() => onExpandChange?.(doc.id)}
            onOpen={() => navigate(`/documents/${doc.id}`)}
            onCreateChild={onCreateChild}
            onArchive={onArchive}
            onToggleCheck={onToggleCheck || (() => {})}
            onTogglePin={onTogglePin}
            onRenameStart={onRenameStart}
            onRenameDraft={onRenameDraft}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            onMove={onMove}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onFocusRow={onFocusRow}
            onMoveFocus={onMoveFocus}
          />
        );
      })}
      {bottomPad > 0 && <div aria-hidden="true" style={{ height: bottomPad }} />}
    </div>
  );
}

/** 扁平搜索结果：标题之外带祖先路径，重名文档也能区分。 */
export function DocSearchResults({ docs, query }: {
  docs: SidebarDocument[];
  query: string;
}) {
  const navigate = useNavigate();
  const params = useParams();
  const q = query.trim().toLowerCase();
  const hits = docs.filter((doc) => doc.title.toLowerCase().includes(q));
  const index = buildDocIndex(docs);
  if (hits.length === 0) {
    return (
      <div className="px-3 py-2.5 text-ui leading-[18px] text-shell-label-tertiary">
        没有匹配的笔记
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {hits.map((doc) => {
        const path = docBreadcrumb(docs, doc.id, index);
        const active = params.documentId === doc.id;
        return (
          <button
            key={doc.id}
            type="button"
            onClick={() => navigate(`/documents/${doc.id}`)}
            aria-current={active ? "page" : undefined}
            aria-label={`${doc.title || "无标题"}${path.length ? `，位于 ${path.join(" / ")}` : ""}`}
            className={cn(
              "flex min-h-9 w-full cursor-pointer select-none items-center gap-1.5 rounded-control px-1.5 py-1 text-left text-ui text-shell-label-primary",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-shell-accent",
              active ? "bg-shell-row-active" : "hover:bg-shell-row-hover",
            )}
          >
            <span className="flex h-5 w-4 flex-none items-center justify-center">
              {doc.icon ? (
                <span className="text-lead leading-none">{doc.icon}</span>
              ) : (
                <FileIcon className="h-4 w-4 text-shell-label-tertiary" strokeWidth={1.75} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui leading-5">{doc.title || "无标题"}</span>
              {path.length > 0 && (
                <span className="block truncate text-caption leading-4 text-shell-label-tertiary">
                  {path.join(" / ")}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
