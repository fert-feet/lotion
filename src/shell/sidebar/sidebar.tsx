"use client";

// 侧边栏的唯一持久实例。
// wide / rail / 窄屏抽屉只是同一棵树的不同呈现：文档、展开状态、搜索词和滚动位置
// 都留在本组件内，切换呈现时不卸载列表，也不会重复请求 sidebar 数据。
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { PenLine, Plus, Search, Sparkles, Star, Store } from "@/components/icons";
import { toast } from "sonner";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import { useLayout } from "@/hooks/use-layout";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import { useHasSlot, useActor, useDocStore } from "@/src/kernel/react";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/components/ui/_focus";
import { SidebarHeader } from "./sidebar-header";
import {
  ancestorDocIds,
  DocTree,
  DocSearchResults,
  visibleDocIds,
  type TreeFocusAction,
} from "./doc-tree";
import { descendantDocIds } from "./doc-tree-model";
import { SidebarFooter } from "./sidebar-footer";
import { MoveDocDialog } from "./move-doc-dialog";
import { SLOT_DETAILS_PANEL } from "../ui-plugins";
import { Button } from "@/components/ui/button";
import ConfirmModal from "@/components/modals/confirm-modal";

interface SidebarProps {
  wide: boolean;
  onExpand: () => void;
  overlay?: boolean;
  drawerActive?: boolean;
}

function pinStorageKey(userId: string | undefined): string | null {
  return userId ? `lotion:sidebar:pins:v1:${userId}` : null;
}

function PinnedDocs({
  docs,
  activeId,
  onOpen,
  onTogglePin,
}: {
  docs: SidebarDocument[];
  activeId: string | undefined;
  onOpen: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  if (docs.length === 0) return null;
  return (
    <section className="mb-2" aria-label="收藏的笔记">
      <div className="mb-1 flex h-6 items-center gap-1.5 px-2 text-caption font-semibold text-shell-label-tertiary">
        <Star className="h-3.5 w-3.5" />
        收藏
      </div>
      <div className="space-y-0.5">
        {docs.map((doc) => (
          <div
            key={doc.id}
            className={cn(
              "group/pin flex h-8 items-center gap-1.5 rounded-control px-2 text-ui",
              activeId === doc.id ? "bg-shell-row-active-accent" : "hover:bg-shell-row-hover",
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(doc.id)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
            >
              <span className="flex h-5 w-4 flex-none items-center justify-center">
                {doc.icon ? (
                  <span className="text-lead leading-none">{doc.icon}</span>
                ) : (
                  <Star className="h-3.5 w-3.5 text-shell-label-tertiary" />
                )}
              </span>
              <span className="truncate">{doc.title || "无标题"}</span>
            </button>
            <button
              type="button"
              aria-label={`取消收藏「${doc.title || "无标题"}」`}
              title="取消收藏"
              onClick={() => onTogglePin(doc.id)}
              className="touch-target flex size-7 flex-none cursor-pointer items-center justify-center rounded-control text-shell-label-tertiary opacity-0 transition-opacity hover:bg-shell-row-active hover:text-shell-label-primary group-hover/pin:opacity-100 group-focus-within/pin:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <Star className="h-3.5 w-3.5 text-shell-accent" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export const Sidebar = memo(function Sidebar({
  wide,
  onExpand,
  overlay = false,
  drawerActive = false,
}: SidebarProps) {
  const docStore = useDocStore();
  const actor = useActor();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { user } = useUser();
  const marketActive = location.pathname === "/market";
  const sidebarKey = useRefresh((s) => s.sidebarKey);
  const triggerSidebar = useRefresh((s) => s.triggerSidebar);
  const detailsOpen = useLayout((s) => s.details > 0);
  const toggleDetails = useLayout((s) => s.toggleDetails);
  const hasAiPanel = useHasSlot(SLOT_DETAILS_PANEL);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const wideRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);

  const [allDocs, setAllDocs] = useState<SidebarDocument[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialLoaded = useRef(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renamingRef = useRef<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");

  useDialogFocus(drawerActive, rootRef);

  useEffect(() => {
    if (!drawerActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExpand();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerActive, onExpand]);

  // 宽栏内容没有卸载：从抽屉关闭回到 rail 时若焦点仍在隐藏内容里，把它送回 rail。
  useEffect(() => {
    if (wide) return;
    if (wideRef.current?.contains(document.activeElement)) {
      railRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, [wide]);

  const loadDocs = useCallback(() => {
    if (!user) return;
    setLoadError(null);
    docStore.listSidebarAll({ userId: user.id })
      .then((data) => {
        setAllDocs(data);
        setLoadError(null);
        initialLoaded.current = true;
      })
      .catch((error: unknown) => {
        if (!initialLoaded.current) setAllDocs([]);
        setLoadError(error instanceof Error ? error.message : "加载笔记列表失败");
      });
  }, [user, docStore]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs, sidebarKey]);

  useEffect(() => {
    const key = pinStorageKey(user?.id);
    if (!key) {
      setPinnedIds(new Set());
      return;
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
      setPinnedIds(new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []));
    } catch {
      setPinnedIds(new Set());
    }
  }, [user?.id]);

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const key = pinStorageKey(user?.id);
      if (key) localStorage.setItem(key, JSON.stringify([...next]));
      return next;
    });
  }, [user?.id]);

  // 直接链接、搜索跳转或 AI 跳转后，自动展开当前文档的祖先链。
  useEffect(() => {
    if (!allDocs || !params.documentId) return;
    const ancestors = ancestorDocIds(allDocs, params.documentId);
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of ancestors) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allDocs, params.documentId]);

  const visibleIds = useMemo(
    () => (allDocs ? visibleDocIds(allDocs, expanded) : []),
    [allDocs, expanded],
  );

  useEffect(() => {
    if (!allDocs) return;
    setFocusedId((current) => {
      if (current && visibleIds.includes(current)) return current;
      if (params.documentId && visibleIds.includes(params.documentId)) return params.documentId;
      return visibleIds[0] ?? null;
    });
  }, [allDocs, params.documentId, visibleIds]);

  const scrollDocIntoView = useCallback((id: string) => {
    const index = visibleIds.indexOf(id);
    const scroller = scrollRef.current;
    const tree = treeRef.current;
    if (index < 0 || !scroller || !tree) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const treeTop = tree.getBoundingClientRect().top - scrollerRect.top + scroller.scrollTop;
    const rowHeight = Number(tree.dataset.rowHeight) || 32;
    const rowTop = treeTop + index * rowHeight;
    if (rowTop < scroller.scrollTop || rowTop + rowHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = Math.max(0, rowTop - scroller.clientHeight / 3);
    }
  }, [visibleIds]);

  useEffect(() => {
    if (!params.documentId || !visibleIds.includes(params.documentId)) return;
    const frame = requestAnimationFrame(() => scrollDocIntoView(params.documentId!));
    return () => cancelAnimationFrame(frame);
  }, [params.documentId, scrollDocIntoView, visibleIds]);

  const focusDocRow = useCallback((id: string) => {
    setFocusedId(id);
    scrollDocIntoView(id);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const row = [...(treeRef.current?.querySelectorAll<HTMLElement>("[data-doc-id]") ?? [])]
          .find((element) => element.dataset.docId === id);
        row?.focus();
      });
    });
  }, [scrollDocIntoView]);

  const moveTreeFocus = useCallback((id: string, action: TreeFocusAction) => {
    if (!allDocs) return;
    if (action === "parent") {
      const parent = allDocs.find((doc) => doc.id === id)?.parentDocument;
      if (parent) focusDocRow(parent);
      return;
    }
    if (visibleIds.length === 0) return;
    if (action === "first") return focusDocRow(visibleIds[0]);
    if (action === "last") return focusDocRow(visibleIds[visibleIds.length - 1]);
    const index = visibleIds.indexOf(id);
    const nextIndex =
      action === "next"
        ? Math.min(visibleIds.length - 1, Math.max(0, index + 1))
        : Math.max(0, visibleIds.indexOf(id) - 1);
    focusDocRow(visibleIds[nextIndex]);
  }, [allDocs, focusDocRow, visibleIds]);

  const onCreate = useCallback(() => {
    if (!user) return;
    const promise = docStore.create({ userId: user.id }, "未命名").then((documentId) => {
      triggerSidebar();
      navigate(`/documents/${documentId}`);
    });
    toast.promise(promise, {
      loading: "正在新建笔记...",
      success: "已新建笔记",
      error: "新建笔记失败，请稍后重试",
    });
  }, [docStore, navigate, triggerSidebar, user]);

  const toggleCheck = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitBatchMode = () => {
    setSelected(new Set());
    setBatchMode(false);
  };

  const batchDelete = () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const promise = Promise.all(ids.map((id) => docStore.remove(actor, id))).then(() => {
      triggerSidebar();
      exitBatchMode();
    });
    toast.promise(promise, {
      loading: `正在删除 ${ids.length} 篇文档...`,
      success: `已删除 ${ids.length} 篇文档`,
      error: "删除失败，请稍后重试",
    });
  };

  const startRename = useCallback((id: string, title: string) => {
    renamingRef.current = id;
    setRenamingId(id);
    setRenameDraft(title || "无标题");
  }, []);

  const cancelRename = useCallback(() => {
    renamingRef.current = null;
    setRenamingId(null);
    setRenameDraft("");
  }, []);

  const commitRename = useCallback((id: string) => {
    if (renamingRef.current !== id) return;
    renamingRef.current = null;
    const current = allDocs?.find((doc) => doc.id === id);
    const nextTitle = renameDraft.trim() || "未命名";
    setRenamingId(null);
    setRenameDraft("");
    if (!current || current.title === nextTitle) return;
    setAllDocs((prev) =>
      prev?.map((doc) => (doc.id === id ? { ...doc, title: nextTitle } : doc)),
    );
    const promise = docStore.update(actor, id, { title: nextTitle })
      .then(() => {
        triggerSidebar();
      })
      .catch((error: unknown) => {
        setAllDocs((prev) =>
          prev?.map((doc) => (doc.id === id ? { ...doc, title: current.title } : doc)),
        );
        throw error;
      });
    toast.promise(promise, {
      loading: "正在重命名...",
      success: "已重命名",
      error: "重命名失败",
    });
  }, [actor, allDocs, docStore, renameDraft, triggerSidebar]);

  const moveDoc = useCallback((id: string, parentDocument: string | null) => {
    if (!allDocs) return;
    const doc = allDocs.find((item) => item.id === id);
    if (!doc || doc.parentDocument === parentDocument) return;
    if (parentDocument && descendantDocIds(allDocs, id).has(parentDocument)) {
      toast.error("不能移动到自身或子文档下");
      return;
    }
    const promise = docStore.move(actor, id, parentDocument).then(() => {
      setAllDocs((prev) =>
        prev?.map((item) =>
          item.id === id ? { ...item, parentDocument } : item,
        ),
      );
      if (parentDocument) {
        setExpanded((prev) => ({ ...prev, [parentDocument]: true }));
      }
      triggerSidebar();
      const targetLabel = parentDocument
        ? `「${allDocs.find((item) => item.id === parentDocument)?.title || "目标页面"}」`
        : "根目录";
      setMoveAnnouncement(`已将「${doc.title || "无标题"}」移动到${targetLabel}`);
    });
    toast.promise(promise, {
      loading: "正在移动...",
      success: "已移动",
      error: "移动失败",
    });
  }, [actor, allDocs, docStore, triggerSidebar]);

  const searching = query.trim() !== "";
  const pinnedDocs = useMemo(
    () =>
      (allDocs ?? [])
        .filter((doc) => pinnedIds.has(doc.id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [allDocs, pinnedIds],
  );

  return (
    <div
      ref={rootRef}
      role={drawerActive ? "dialog" : undefined}
      aria-modal={drawerActive ? "true" : undefined}
      aria-label={drawerActive ? "笔记导航" : undefined}
      id="sidebar-shell"
      tabIndex={drawerActive ? -1 : undefined}
      data-sidebar-shell
      data-sidebar-wide={wide || undefined}
      className="@container/sidebar relative h-full min-h-0 overflow-hidden outline-none"
    >
      <div
        ref={wideRef}
        aria-hidden={!wide || undefined}
        inert={!wide || undefined}
        className={cn(
          "absolute inset-0 flex min-h-0 flex-col px-2 pb-2 pt-2.5",
          "transition-[opacity,transform] duration-200 ease-[var(--ds-ease-out)]",
          "motion-reduce:translate-x-0",
          wide
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none -translate-x-2 opacity-0",
        )}
      >
        <SidebarHeader
          active={wide}
          query={query}
          onQueryChange={setQuery}
          expanded={searchExpanded}
          onExpandedChange={setSearchExpanded}
          onCreate={onCreate}
          onOpenMarket={() => navigate("/market")}
          marketActive={marketActive}
          onCollapse={overlay ? onExpand : undefined}
        />

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div ref={scrollRef} data-sidebar-scroll className="h-full min-h-0 overflow-y-auto pb-2">
            {loadError && (
              <div
                role="alert"
                className="mx-2 mb-2 rounded-card bg-destructive/10 px-2.5 py-2 text-ui-sm text-destructive"
              >
                <p className="leading-5">{loadError}</p>
                <button
                  type="button"
                  onClick={loadDocs}
                  className="mt-1 cursor-pointer font-medium text-primary hover:underline"
                >
                  重试
                </button>
              </div>
            )}

            {draggedId && (
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  moveDoc(draggedId, null);
                  setDraggedId(null);
                }}
                className="mx-2 mb-2 flex h-8 items-center justify-center rounded-control hairline border-dashed border-shell-accent/50 bg-shell-row-active-accent text-ui-sm text-shell-accent"
              >
                松开以移到根目录
              </div>
            )}

            {allDocs === undefined ? (
              <div className="space-y-1 px-3 py-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-shell-row-active" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-shell-row-active" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-shell-row-active" />
              </div>
            ) : allDocs.length === 0 ? (
              loadError ? null : (
                <div className="px-2 py-3 text-ui-sm leading-[18px] text-shell-label-tertiary">
                  还没有笔记
                </div>
              )
            ) : searching ? (
              <DocSearchResults docs={allDocs} query={query} />
            ) : (
              <>
                <PinnedDocs
                  docs={pinnedDocs}
                  activeId={params.documentId}
                  onOpen={(id) => navigate(`/documents/${id}`)}
                  onTogglePin={togglePin}
                />
                <div ref={treeRef} role="tree" aria-label="笔记">
                  <DocTree
                    docs={allDocs}
                    pinnedIds={pinnedIds}
                    expanded={expanded}
                    onExpandChange={(id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))}
                    batchMode={batchMode}
                    selected={selected}
                    onToggleCheck={toggleCheck}
                    focusedId={focusedId}
                    renamingId={renamingId}
                    renameDraft={renameDraft}
                    draggedId={draggedId}
                    onTogglePin={togglePin}
                    onRenameStart={startRename}
                    onRenameDraft={setRenameDraft}
                    onRenameCommit={commitRename}
                    onRenameCancel={cancelRename}
                    onMove={moveDoc}
                    onRequestMove={setMovingId}
                    onDragStart={setDraggedId}
                    onDragEnd={() => setDraggedId(null)}
                    onFocusRow={setFocusedId}
                    onMoveFocus={moveTreeFocus}
                  />
                </div>
              </>
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-shell-sidebar to-transparent" />
        </div>

        {batchMode ? (
          <div className="flex shrink-0 items-center gap-2 hairline-t border-shell-border px-3 py-2">
            <span className="flex-1 truncate text-ui-sm text-shell-label-secondary">
              已选 {selected.size} 篇
            </span>
            <ConfirmModal
              onConfirm={batchDelete}
              title={`删除这 ${selected.size} 篇笔记？`}
              description="删除后无法恢复。"
            >
              <Button size="sm" variant="destructive" disabled={selected.size === 0} className="h-7 cursor-pointer text-ui-sm">
                删除
              </Button>
            </ConfirmModal>
            <Button size="sm" variant="ghost" className="h-7 cursor-pointer text-ui-sm" onClick={exitBatchMode}>
              取消
            </Button>
          </div>
        ) : (
          <SidebarFooter onBatchMode={() => setBatchMode(true)} />
        )}
      </div>

      <MoveDocDialog
        docs={allDocs ?? []}
        documentId={movingId}
        open={movingId !== null}
        onOpenChange={(open) => {
          if (!open) setMovingId(null);
        }}
        onMove={moveDoc}
      />
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {moveAnnouncement}
      </p>

      <div
        ref={railRef}
        aria-hidden={wide || undefined}
        inert={wide || undefined}
        className={cn(
          "absolute inset-0 flex flex-col items-center gap-1 py-3",
          "transition-[opacity,transform] duration-150 ease-[var(--ds-ease-out)]",
          "motion-reduce:scale-100",
          wide
            ? "pointer-events-none scale-95 opacity-0"
            : "pointer-events-auto scale-100 opacity-100",
        )}
      >
        <button
          type="button"
          aria-label="打开笔记列表"
          title="打开笔记列表"
          aria-controls="sidebar-shell"
          aria-expanded="false"
          onClick={onExpand}
          className="touch-target mb-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-card bg-ai text-ai-foreground"
        >
          <PenLine className="h-4 w-4" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          aria-label="筛选当前文档树"
          title="筛选当前文档树"
          aria-controls="sidebar-shell"
          aria-expanded="false"
          onClick={() => {
            setSearchExpanded(true);
            onExpand();
          }}
          className="touch-target flex h-9 w-9 cursor-pointer items-center justify-center rounded-card text-shell-label-primary hover:bg-shell-row-hover"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="新建笔记"
          title="新建笔记"
          onClick={onCreate}
          className="touch-target flex h-9 w-9 cursor-pointer items-center justify-center rounded-card text-shell-label-primary hover:bg-shell-row-hover"
        >
          <Plus className="h-4 w-4" />
        </button>
        {hasAiPanel && (
          <button
            type="button"
            aria-label="AI 助手"
            title="AI 助手"
            onClick={toggleDetails}
            className={cn(
              "touch-target flex h-9 w-9 cursor-pointer items-center justify-center rounded-card text-shell-label-primary hover:bg-shell-row-hover",
              detailsOpen && "bg-ai text-ai-foreground hover:bg-ai",
            )}
          >
            <Sparkles className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-label="插件市场"
          title="插件市场"
          onClick={() => navigate("/market")}
          className={cn(
            "touch-target flex h-9 w-9 cursor-pointer items-center justify-center rounded-card text-shell-label-primary hover:bg-shell-row-hover",
            marketActive && "bg-shell-row-active",
          )}
        >
          <Store className="h-4 w-4" />
        </button>
        <div className="mt-auto" />
        <SidebarFooter rail onBatchMode={() => { setBatchMode(true); onExpand(); }} />
      </div>
    </div>
  );
});

export default Sidebar;
