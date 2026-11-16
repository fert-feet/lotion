"use client";

// 侧边栏头部 —— macOS 语言：
// 填充式筛选框（放大镜内置、无边框）+ 24px 图标按钮，筛选在左、操作在右。
// 不再有「文档」小标题：它既不是工作区名也不是当前文档名，只是给列表起个名字，
// 而列表内容本身就说明了它是文档；去掉后这一行只保留可操作的东西。
// expanded 由父级控制（rail 的搜索按钮点击后展开侧边栏并强制展开搜索框）。
// 插件市场入口就在这里（与 AI 助手 / 新建同一组 toolbar 图标），不再单占一整行。
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus, Search, Sparkles, Store, X } from "@/components/icons";
import { useLayout } from "@/hooks/use-layout";
import { useHasSlot } from "@/src/kernel/react";
import { SLOT_DETAILS_PANEL } from "../ui-plugins";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SidebarHeaderProps {
  /** 宽栏内容是否真实可见；rail 状态下搜索框不应抢焦点 */
  active?: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onCreate: () => void;
  /** 打开插件市场（/market）；放在顶部图标组里 */
  onOpenMarket: () => void;
  /** 当前是否停在 /market（选中态高亮） */
  marketActive?: boolean;
  /** 窄屏覆盖式侧边栏的显式收起入口 */
  onCollapse?: () => void;
}

/** 图标按钮：24px 圆形，hover 出现填充底（Apple 的 toolbar button） */
const iconBtn =
  "touch-target flex size-7 flex-none cursor-pointer items-center justify-center rounded-control bg-transparent p-0 text-shell-label-secondary transition-colors duration-150 hover:bg-shell-row-hover hover:text-shell-label-primary";

export function SidebarHeader({
  active = true,
  query,
  onQueryChange,
  expanded,
  onExpandedChange,
  onCreate,
  onOpenMarket,
  marketActive = false,
  onCollapse,
}: SidebarHeaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const detailsOpen = useLayout((s) => s.details > 0);
  const toggleDetails = useLayout((s) => s.toggleDetails);
  // 入口跟着插件走：ui-ai-panel 被禁用时这里不能还留一个能点的 AI 按钮
  const hasAiPanel = useHasSlot(SLOT_DETAILS_PANEL);

  useEffect(() => {
    if (expanded && active) inputRef.current?.focus({ preventScroll: true });
  }, [active, expanded]);

  useEffect(() => {
    if (!active) setMoreOpen(false);
  }, [active]);

  useEffect(() => {
    if (!expanded) return;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && inputRef.current?.closest("[data-sidebar-search]")?.contains(event.target)) return;
      if (query !== "") return;
      onExpandedChange(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [expanded, query, onExpandedChange]);

  const collapse = () => {
    onExpandedChange(false);
    onQueryChange("");
  };

  return (
    <div
      data-sidebar-header
      className="mb-2 flex h-7 shrink-0 items-center justify-between gap-1 px-0.5 @max-[300px]/sidebar:gap-0 @max-[300px]/sidebar:px-0"
    >
      {/* 搜索框：Apple 的填充式搜索（放大镜内置）；收起时是左侧的放大镜图标 */}
      <div className={cn("flex min-w-0 flex-1 items-center transition-all duration-200 ease-[var(--ds-ease-in-out)]", expanded ? "max-w-full" : "max-w-6")}>
        <div
          data-sidebar-search
          onClick={() => onExpandedChange(true)}
          className={cn(
            "flex h-6 w-full cursor-text items-center overflow-hidden rounded-control bg-transparent text-shell-label-secondary transition-all duration-200 ease-[var(--ds-ease-in-out)]",
            expanded && "h-7 rounded-control bg-secondary text-shell-label-tertiary"
          )}
        >
          <button
            type="button"
            aria-label="筛选当前文档树"
            title="筛选当前文档树"
            onClick={(e) => {
              e.stopPropagation();
              if (!expanded) { onExpandedChange(true); inputRef.current?.focus(); }
            }}
            className={cn(iconBtn, expanded && "ml-0.5")}
          >
            <Search className="h-4 w-4" />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="筛选当前文档树"
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") collapse();
            }}
            className={cn(
              "w-0 min-w-0 flex-1 border-none bg-transparent pr-1 text-ui leading-[18px] text-shell-label-primary opacity-0 outline-none transition-opacity duration-100 placeholder:text-shell-label-placeholder",
              expanded && "opacity-100"
            )}
            tabIndex={expanded ? 0 : -1}
          />
          {expanded && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={(e) => {
                e.stopPropagation();
                collapse();
              }}
              className={cn(iconBtn, "mr-0.5")}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* 操作按钮：新建保持一级入口，市场与 AI 收进「更多」，避免 280px 头部拥挤。 */}
      <div
        aria-hidden={expanded || undefined}
        inert={expanded || undefined}
        className={cn(
          "flex flex-none items-center gap-0.5 transition-all duration-200 ease-[var(--ds-ease-in-out)]",
          expanded && "pointer-events-none max-w-0 translate-x-1 overflow-hidden opacity-0",
        )}
      >
        <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="更多侧边栏操作"
              title="更多"
              className={iconBtn}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {hasAiPanel && (
              <DropdownMenuItem
                aria-label="AI 助手"
                onClick={() => {
                  setMoreOpen(false);
                  toggleDetails();
                  onCollapse?.();
                }}
                className="cursor-pointer"
              >
                <Sparkles className={cn("mr-2 h-4 w-4", detailsOpen && "text-shell-accent")} />
                {detailsOpen ? "关闭 AI 助手" : "打开 AI 助手"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              aria-label="插件市场"
              onClick={() => {
                setMoreOpen(false);
                onOpenMarket();
              }}
              aria-current={marketActive ? "page" : undefined}
              className="cursor-pointer"
            >
              <Store className={cn("mr-2 h-4 w-4", marketActive && "text-shell-accent")} />
              插件市场
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label="新建笔记"
          title="新建笔记"
          onClick={onCreate}
          className={iconBtn}
        >
          <Plus className="h-4 w-4" />
        </button>
        {onCollapse && (
          <button
            type="button"
            aria-label="收起侧边栏"
            title="收起侧边栏"
            onClick={onCollapse}
            className={iconBtn}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
