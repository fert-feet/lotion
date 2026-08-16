"use client";

// 侧边栏头部（移植 DSH WorkspaceBrowser 的 sectionHeader 设计）：
// 标题 + 内嵌搜索胶囊（展开为全宽输入框，标题/操作按钮让位）+ 圆形图标操作。
// expanded 由父级控制（rail 的搜索按钮点击后展开侧边栏并强制展开胶囊）。
import { useEffect, useRef } from "react";
import { Plus, Search, Sparkles, X } from "@/components/icons";
import { useLayout } from "@/hooks/use-layout";
import { cn } from "@/lib/utils";

interface SidebarHeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onCreate: () => void;
  label: string;
}

export function SidebarHeader({ query, onQueryChange, expanded, onExpandedChange, onCreate, label }: SidebarHeaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const detailsOpen = useLayout((s) => s.details > 0);
  const toggleDetails = useLayout((s) => s.toggleDetails);

  useEffect(() => {
    if (expanded) inputRef.current?.focus({ preventScroll: true });
  }, [expanded]);

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
    <div className="mb-1 flex h-9 shrink-0 items-center justify-end gap-1 overflow-hidden rounded-xl px-1 text-shell-label-tertiary">
      {/* 标题：搜索展开时折叠让位 */}
      <span
        className={cn(
          "min-w-0 max-w-[45%] flex-none overflow-hidden text-ellipsis whitespace-nowrap leading-5 transition-all duration-200 ease-[var(--ds-ease-in-out)]",
          expanded && "max-w-0 -mr-1 translate-x-[-4px] opacity-0"
        )}
      >
        {label}
      </span>

      {/* 搜索胶囊：点击展开全宽，输入过滤文档树 */}
      <div className={cn("flex min-w-0 flex-1 items-center transition-all duration-200 ease-[var(--ds-ease-in-out)]", expanded ? "max-w-full" : "max-w-7")}>
        <div
          data-sidebar-search
          onClick={() => onExpandedChange(true)}
          className={cn(
            "flex h-7 w-full cursor-text items-center gap-0 overflow-hidden rounded-full bg-transparent text-shell-label-secondary transition-all duration-200 ease-[var(--ds-ease-in-out)]",
            expanded && "h-[30px] rounded-[10px] border border-shell-border-l2 bg-transparent text-shell-label-caption"
          )}
        >
          <button
            type="button"
            aria-label="搜索笔记"
            title="搜索笔记（Cmd/Ctrl+J）"
            onClick={(e) => {
              e.stopPropagation();
              if (!expanded) { onExpandedChange(true); inputRef.current?.focus(); }
            }}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-transparent p-0 text-inherit hover:bg-shell-row-hover"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="搜索笔记…"
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") collapse();
            }}
            className={cn(
              "w-0 min-w-0 flex-1 border-none bg-transparent text-[13px] leading-[18px] text-shell-label-primary opacity-0 outline-none transition-opacity duration-100 placeholder:text-shell-label-tertiary",
              expanded && "ml-[-2px] opacity-100"
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
              className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-transparent p-0 text-shell-label-secondary hover:bg-shell-row-hover"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 操作按钮：AI 助手 + 新建；搜索展开时让位隐藏 */}
      <div className={cn("flex max-w-[60px] flex-none items-center gap-1 overflow-hidden transition-all duration-200 ease-[var(--ds-ease-in-out)]", expanded && "max-w-0 translate-x-1 opacity-0")}>
        <button
          type="button"
          aria-label="AI 助手"
          title="AI 助手"
          onClick={toggleDetails}
          className={cn(
            "flex h-7 w-7 flex-none items-center justify-center rounded-full bg-transparent p-0 text-shell-label-secondary hover:bg-shell-row-hover",
            detailsOpen && "bg-ai text-ai-foreground hover:bg-ai"
          )}
        >
          <Sparkles className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="新建笔记"
          title="新建笔记"
          onClick={onCreate}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-transparent p-0 text-shell-label-secondary hover:bg-shell-row-hover"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
