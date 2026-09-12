"use client";

// 侧边栏根组件（移植 DSH WorkspaceBrowser 结构）：
// wide 形态 = header(标题+搜索胶囊+操作) + 文档树 + 底部图标栏 + 列表底部渐变；
// rail 形态（56px）= 36px 图标控件列：logo / 搜索 / 新建 / AI，底部设置/回收站/批量/用户。
import { useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import { PenLine, Plus, Search, Sparkles } from "@/components/icons";
import { toast } from "sonner";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import { useLayout } from "@/hooks/use-layout";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "./sidebar-header";
import { DocTree, DocSearchResults } from "./doc-tree";
import { SidebarFooter } from "./sidebar-footer";
import { Button } from "@/components/ui/button";
import ConfirmModal from "@/components/modals/confirm-modal";

interface SidebarProps {
  wide: boolean;
  onExpand: () => void;
}

export function Sidebar({ wide, onExpand }: SidebarProps) {
  const docStore = useDocStore();
  const actor = useActor();
  const navigate = useNavigate();
  const { user } = useUser();
  const sidebarKey = useRefresh((s) => s.sidebarKey);
  const triggerSidebar = useRefresh((s) => s.triggerSidebar);
  const detailsOpen = useLayout((s) => s.details > 0);
  const toggleDetails = useLayout((s) => s.toggleDetails);

  const [allDocs, setAllDocs] = useState<SidebarDocument[] | undefined>(undefined);
  const initialLoaded = useRef(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user) {
      docStore.listSidebarAll({ userId: user.id })
        .then((data) => { setAllDocs(data); initialLoaded.current = true; })
        .catch(() => { if (!initialLoaded.current) setAllDocs([]); });
    }
  }, [user, sidebarKey, docStore]);

  const onCreate = () => {
    if (!user) return;
    const promise = docStore.create({ userId: user.id }, "Untitled").then((documentId) => {
      triggerSidebar();
      navigate("/documents/" + documentId);
    });
    toast.promise(promise, {
      loading: "Creating a new note...",
      success: "New note created",
      error: "Failed to create a new note.",
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
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-ai text-ai-foreground">
          <PenLine className="h-4 w-4" strokeWidth={2.5} />
        </div>
        <button
          type="button"
          aria-label="搜索笔记"
          title="搜索笔记"
          onClick={() => {
            setSearchExpanded(true);
            onExpand();
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full text-shell-label-primary hover:bg-shell-row-hover"
        >
          <Search className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          aria-label="新建笔记"
          title="新建笔记"
          onClick={onCreate}
          className="flex h-9 w-9 items-center justify-center rounded-full text-shell-label-primary hover:bg-shell-row-hover"
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          aria-label="AI 助手"
          title="AI 助手"
          onClick={toggleDetails}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full text-shell-label-primary hover:bg-shell-row-hover",
            detailsOpen && "bg-ai text-ai-foreground hover:bg-ai"
          )}
        >
          <Sparkles className="h-[18px] w-[18px]" />
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
        label="文档"
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
            <div className="px-2 py-3 text-[12px] leading-[18px] text-shell-label-tertiary">
              还没有笔记，点 + 新建一篇，或让 AI 帮你写
            </div>
          ) : searching ? (
            <DocSearchResults docs={allDocs} query={query} />
          ) : (
            <DocTree
              docs={allDocs}
              expanded={expanded}
              onExpandChange={(id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))}
              batchMode={batchMode}
              selected={selected}
              onToggleCheck={toggleCheck}
            />
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-shell-sidebar to-transparent" />
      </div>

      {/* 批量删除操作条 */}
      {batchMode ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-shell-border px-3 py-2">
          <span className="flex-1 truncate text-xs text-shell-label-secondary">已选 {selected.size} 篇</span>
          <ConfirmModal onConfirm={batchDelete}>
            <Button size="sm" variant="destructive" disabled={selected.size === 0} className="h-7 cursor-pointer text-xs">
              删除
            </Button>
          </ConfirmModal>
          <Button size="sm" variant="ghost" className="h-7 cursor-pointer text-xs" onClick={exitBatchMode}>
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
