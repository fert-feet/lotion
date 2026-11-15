"use client";

// 侧边栏根组件（移植 DSH WorkspaceBrowser 结构）：
// wide 形态 = header(搜索框+操作图标) + 文档树 + 底部图标栏 + 列表底部渐变；
// rail 形态（56px）= 36px 图标控件列：logo / 搜索 / 新建 / AI，底部设置/回收站/批量/用户。
import { useLocation, useNavigate, useParams } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PenLine, Plus, Search, Sparkles, Store } from "@/components/icons";
import { toast } from "sonner";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import { useLayout } from "@/hooks/use-layout";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import { useHasSlot, useActor, useDocStore } from "@/src/kernel/react";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "./sidebar-header";
import {
  ancestorDocIds,
  DocTree,
  DocSearchResults,
  visibleDocIds,
  type TreeFocusAction,
} from "./doc-tree";
import { SidebarFooter } from "./sidebar-footer";
import { SLOT_DETAILS_PANEL } from "../ui-plugins";
import { Button } from "@/components/ui/button";
import ConfirmModal from "@/components/modals/confirm-modal";

interface SidebarProps {
  wide: boolean;
  onExpand: () => void;
  overlay?: boolean;
}

export function Sidebar({ wide, onExpand, overlay = false }: SidebarProps) {
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
  // AI 入口跟着插件走：ui-ai-panel 被禁用后按钮不能还在（点了只会开出一列空白）
  const hasAiPanel = useHasSlot(SLOT_DETAILS_PANEL);

  const [allDocs, setAllDocs] = useState<SidebarDocument[] | undefined>(undefined);
  const initialLoaded = useRef(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (user) {
      docStore.listSidebarAll({ userId: user.id })
        .then((data) => { setAllDocs(data); initialLoaded.current = true; })
        .catch(() => { if (!initialLoaded.current) setAllDocs([]); });
    }
  }, [user, sidebarKey, docStore]);

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

  // 树只有一个 Tab 停点：优先当前文档，否则第一条可见行。
  useEffect(() => {
    if (!allDocs) return;
    const visible = visibleDocIds(allDocs, expanded);
    setFocusedId((current) => {
      if (current && visible.includes(current)) return current;
      if (params.documentId && visible.includes(params.documentId)) return params.documentId;
      return visible[0] ?? null;
    });
  }, [allDocs, expanded, params.documentId]);

  const focusDocRow = useCallback((id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => {
      const row = [...(treeRef.current?.querySelectorAll<HTMLElement>("[data-doc-id]") ?? [])]
        .find((element) => element.dataset.docId === id);
      row?.focus();
    });
  }, []);

  const moveTreeFocus = useCallback((id: string, action: TreeFocusAction) => {
    if (!allDocs) return;
    if (action === "parent") {
      const parent = allDocs.find((doc) => doc.id === id)?.parentDocument;
      if (parent) focusDocRow(parent);
      return;
    }
    const ids = visibleDocIds(allDocs, expanded);
    if (ids.length === 0) return;
    if (action === "first") return focusDocRow(ids[0]);
    if (action === "last") return focusDocRow(ids[ids.length - 1]);
    const index = ids.indexOf(id);
    const nextIndex =
      action === "next"
        ? Math.min(ids.length - 1, Math.max(0, index + 1))
        : Math.max(0, index - 1);
    focusDocRow(ids[nextIndex]);
  }, [allDocs, expanded, focusDocRow]);

  const onCreate = () => {
    if (!user) return;
    const promise = docStore.create({ userId: user.id }, "未命名").then((documentId) => {
      triggerSidebar();
      navigate("/documents/" + documentId);
    });
    toast.promise(promise, {
      loading: "正在新建笔记...",
      success: "已新建笔记",
      error: "新建笔记失败，请稍后重试",
    });
  };

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
      loading: "正在删除 " + ids.length + " 篇文档...",
      success: "已删除 " + ids.length + " 篇文档",
      error: "删除失败，请稍后重试",
    });
  };

  const searching = query.trim() !== "";

  // ---- rail 形态：56px 图标列 ----
  if (!wide) {
    return (
      <div className="flex h-full flex-col items-center gap-1 py-3">
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-card bg-ai text-ai-foreground">
          <PenLine className="h-4 w-4" strokeWidth={2.5} />
        </div>
        <button
          type="button"
          aria-label="筛选当前文档树"
          title="筛选当前文档树"
          onClick={() => {
            setSearchExpanded(true);
            onExpand();
          }}
          className="flex h-9 w-9 items-center justify-center rounded-card text-shell-label-primary hover:bg-shell-row-hover"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="新建笔记"
          title="新建笔记"
          onClick={onCreate}
          className="flex h-9 w-9 items-center justify-center rounded-card text-shell-label-primary hover:bg-shell-row-hover"
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
              "flex h-9 w-9 items-center justify-center rounded-card text-shell-label-primary hover:bg-shell-row-hover",
              detailsOpen && "bg-ai text-ai-foreground hover:bg-ai"
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
            "flex h-9 w-9 items-center justify-center rounded-card text-shell-label-primary hover:bg-shell-row-hover",
            marketActive && "bg-shell-row-active",
          )}
        >
          <Store className="h-4 w-4" />
        </button>
        <div className="mt-auto" />
        <SidebarFooter rail onBatchMode={() => { setBatchMode(true); onExpand(); }} />
      </div>
    );
  }

  // ---- wide 形态 ----
  return (
    <div className="flex h-full min-h-0 flex-col px-2 pb-2 pt-2.5">
      <SidebarHeader
        query={query}
        onQueryChange={setQuery}
        expanded={searchExpanded}
        onExpandedChange={setSearchExpanded}
        onCreate={onCreate}
        onOpenMarket={() => navigate("/market")}
        marketActive={marketActive}
        onCollapse={overlay ? onExpand : undefined}
      />

      {/* 列表区：唯一滚动区域；底部渐变 fade 贴住可见底边 */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="h-full min-h-0 overflow-y-auto pb-2">
          {allDocs === undefined ? (
            <div className="space-y-1 px-3 py-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-shell-row-active" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-shell-row-active" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-shell-row-active" />
            </div>
          ) : allDocs.length === 0 ? (
            <div className="px-2 py-3 text-ui-sm leading-[18px] text-shell-label-tertiary">
              还没有笔记
            </div>
          ) : searching ? (
            <DocSearchResults docs={allDocs} query={query} />
          ) : (
            <div ref={treeRef} role="tree" aria-label="笔记">
              <DocTree
                docs={allDocs}
                expanded={expanded}
                onExpandChange={(id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))}
                batchMode={batchMode}
                selected={selected}
                onToggleCheck={toggleCheck}
                focusedId={focusedId}
                onFocusRow={setFocusedId}
                onMoveFocus={moveTreeFocus}
              />
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-shell-sidebar to-transparent" />
      </div>

      {/* 批量删除操作条 */}
      {batchMode ? (
        <div className="flex shrink-0 items-center gap-2 hairline-t border-shell-border px-3 py-2">
          <span className="flex-1 truncate text-ui-sm text-shell-label-secondary">已选 {selected.size} 篇</span>
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
  );
}

export default Sidebar;
